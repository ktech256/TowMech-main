import express from "express";
import mongoose from "mongoose"; // ✅ needed for aggregation ObjectId
import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";
import Rating from "../models/Rating.js";
import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import PricingConfig from "../models/PricingConfig.js";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";

import { findNearbyProviders } from "../utils/findNearbyProviders.js";
import { sendJobCompletedEmail } from "../utils/sendJobCompletedEmail.js";
import { sendJobAcceptedEmail } from "../utils/sendJobAcceptedEmail.js";

// ✅ NEW PRICING FUNCTION
import { calculateJobPricing } from "../utils/calculateJobPricing.js";

const router = express.Router();

/**
 * ✅ NEW: statuses that should BLOCK a customer from creating another job
 * - We do NOT include CREATED, because that can be an unpaid/draft job.
 */
const CUSTOMER_BLOCK_STATUSES = [
  JOB_STATUSES.BROADCASTED,
  JOB_STATUSES.ASSIGNED,
  JOB_STATUSES.IN_PROGRESS,
];

/**
 * ✅ NEW: Customer cancellation windows
 */
const CUSTOMER_CANCEL_REFUND_WINDOW_MS = 3 * 60 * 1000; // 3 minutes after ASSIGNED
const PROVIDER_NO_SHOW_REFUND_WINDOW_MS = 45 * 60 * 1000; // 45 minutes after ASSIGNED

/**
 * ✅ NEW: Provider start-job distance rule
 */
const START_JOB_MAX_DISTANCE_METERS = 30;

/**
 * ✅ TowTruck Type Normalizer (NEW preferred names + legacy compatibility)
 * - Keeps system stable while DB/clients may still send old values
 * - Outputs the new preferred names used in PricingConfig multipliers
 */
function normalizeTowTruckType(type) {
  if (!type) return null;
  const x = String(type).trim();
  const lower = x.toLowerCase();

  // ✅ NEW preferred names + common variants
  if (lower.includes("hook") && lower.includes("chain")) return "Hook & Chain";

  if (lower === "wheel-lift" || lower === "wheel lift") return "Wheel-Lift";

  if (
    lower === "flatbed" ||
    lower === "rollback" ||
    lower === "roll back" ||
    lower === "flatbed/roll back" ||
    lower === "flatbed/rollback"
  )
    return "Flatbed/Roll Back";

  if (lower.includes("boom")) return "Boom Trucks(With Crane)";

  if (lower.includes("integrated") || lower.includes("wrecker")) return "Integrated / Wrecker";

  if (lower.includes("rotator") || lower.includes("heavy-duty") || lower === "recovery")
    return "Heavy-Duty Rotator(Recovery)";

  // ✅ Legacy values mapping (safe)
  if (lower === "towtruck") return "Integrated / Wrecker";
  if (lower === "towtruck-xl" || lower === "towtruck xl") return "Integrated / Wrecker";
  if (lower === "towtruck-xxl" || lower === "towtruck xxl") return "Integrated / Wrecker";

  // If it doesn't match anything, keep as-is (don’t break unexpected custom values)
  return x;
}

/**
 * ✅ Helper: Recompute rating stats for a target user
 * IMPORTANT: uses Rating schema fields: target + targetRole
 */
async function recomputeUserRatingStats(userId) {
  const targetId = new mongoose.Types.ObjectId(userId);

  // Provider stats: targetRole != "Customer"
  const providerAgg = await Rating.aggregate([
    { $match: { target: targetId, targetRole: { $ne: "Customer" } } },
    { $group: { _id: "$target", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  // Customer stats: targetRole == "Customer"
  const customerAgg = await Rating.aggregate([
    { $match: { target: targetId, targetRole: "Customer" } },
    { $group: { _id: "$target", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  const providerStats = providerAgg[0]
    ? { avg: Number(providerAgg[0].avg.toFixed(2)), count: providerAgg[0].count }
    : { avg: 0, count: 0 };

  const customerStats = customerAgg[0]
    ? { avg: Number(customerAgg[0].avg.toFixed(2)), count: customerAgg[0].count }
    : { avg: 0, count: 0 };

  await User.findByIdAndUpdate(userId, {
    $set: {
      "ratingStats.asProvider": providerStats,
      "ratingStats.asCustomer": customerStats,
    },
  });
}

/**
 * ✅ Helper: Haversine Distance (km)
 */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;

  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/**
 * ✅ Helper: Haversine Distance (meters)
 */
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  return Math.round(haversineDistanceKm(lat1, lng1, lat2, lng2) * 1000);
}

/**
 * ✅ PREVIEW JOB
 * POST /api/jobs/preview
 */
router.post(
  "/preview",
  auth,
  authorizeRoles(USER_ROLES.CUSTOMER),
  async (req, res) => {
    try {
      console.log("✅ PREVIEW HIT");
      console.log("✅ BODY RECEIVED:", req.body);

      const {
        title,
        description,
        roleNeeded,
        pickupLat,
        pickupLng,
        pickupAddressText,
        dropoffLat,
        dropoffLng,
        dropoffAddressText,
        towTruckTypeNeeded,
        vehicleType,
      } = req.body;

      if (!title || !roleNeeded || pickupLat === undefined || pickupLng === undefined) {
        return res.status(400).json({
          message: "title, roleNeeded, pickupLat, pickupLng are required",
        });
      }

      if (
        roleNeeded === USER_ROLES.TOW_TRUCK &&
        (dropoffLat === undefined || dropoffLng === undefined)
      ) {
        return res.status(400).json({
          message: "TowTruck jobs require dropoffLat and dropoffLng",
        });
      }

      const normalizedTowTruckTypeNeeded = towTruckTypeNeeded
        ? normalizeTowTruckType(towTruckTypeNeeded)
        : null;

      let config = await PricingConfig.findOne();
      if (!config) config = await PricingConfig.create({});

      let towTruckTypes = config.towTruckTypes || [];

      if (!towTruckTypes || towTruckTypes.length === 0) {
        console.log("⚠️ towTruckTypes empty → setting defaults...");

        config.towTruckTypes = [
          "Hook & Chain",
          "Wheel-Lift",
          "Flatbed/Roll Back",
          "Boom Trucks(With Crane)",
          "Integrated / Wrecker",
          "Heavy-Duty Rotator(Recovery)",
        ];

        await config.save();
        towTruckTypes = config.towTruckTypes;
      }

      const distanceKm =
        roleNeeded === USER_ROLES.TOW_TRUCK &&
        dropoffLat !== undefined &&
        dropoffLng !== undefined
          ? haversineDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng)
          : 0;

      if (normalizedTowTruckTypeNeeded) {
        const pricing = await calculateJobPricing({
          roleNeeded,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          towTruckTypeNeeded: normalizedTowTruckTypeNeeded,
          vehicleType,
          distanceKm,
        });

        const providers = await findNearbyProviders({
          roleNeeded,
          pickupLng,
          pickupLat,
          towTruckTypeNeeded: normalizedTowTruckTypeNeeded,
          vehicleType,
          excludedProviders: [],
          maxDistanceMeters: 20000,
          limit: 10,
        });

        return res.status(200).json({
          providersFound: providers.length > 0,
          providerCount: providers.length,
          message:
            providers.length > 0
              ? "Providers found ✅ Please pay booking fee to proceed"
              : "No providers online within range. Booking fee not required.",
          preview: pricing,
        });
      }

      const resultsByTowTruckType = {};

      for (const type of towTruckTypes) {
        const normalizedType = normalizeTowTruckType(type);

        const pricing = await calculateJobPricing({
          roleNeeded,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          towTruckTypeNeeded: normalizedType,
          vehicleType,
          distanceKm,
        });

        const providersForType = await findNearbyProviders({
          roleNeeded,
          pickupLng,
          pickupLat,
          towTruckTypeNeeded: normalizedType,
          vehicleType,
          excludedProviders: [],
          maxDistanceMeters: 20000,
          limit: 10,
        });

        resultsByTowTruckType[type] = {
          estimatedTotal: pricing.estimatedTotal,
          bookingFee: pricing.bookingFee,
          currency: pricing.currency,
          estimatedDistanceKm: pricing.estimatedDistanceKm,
          towTruckTypeMultiplier: pricing.towTruckTypeMultiplier,
          vehicleTypeMultiplier: pricing.vehicleTypeMultiplier,
          providersCount: providersForType.length,
          status: providersForType.length > 0 ? "ONLINE" : "OFFLINE",
        };
      }

      const providers = await findNearbyProviders({
        roleNeeded,
        pickupLng,
        pickupLat,
        towTruckTypeNeeded: null,
        vehicleType,
        excludedProviders: [],
        maxDistanceMeters: 20000,
        limit: 10,
      });

      return res.status(200).json({
        providersFound: providers.length > 0,
        providerCount: providers.length,
        message:
          providers.length > 0
            ? "Providers found ✅ Please select tow truck type"
            : "No providers online within range.",
        preview: {
          currency: config.currency || "ZAR",
          distanceKm,
          resultsByTowTruckType,
        },
      });
    } catch (err) {
      console.error("❌ PREVIEW ERROR:", err);
      return res.status(500).json({
        message: "Could not preview job",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ CUSTOMER creates job
 * POST /api/jobs
 */
router.post("/", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    console.log("✅ CREATE JOB HIT");
    console.log("✅ BODY RECEIVED:", req.body);

    // ✅ Block customer ONLY if they already have a BROADCASTED/ASSIGNED/IN_PROGRESS job
    const existingActive = await Job.findOne({
      customer: req.user._id,
      status: { $in: CUSTOMER_BLOCK_STATUSES },
    })
      .select("_id status createdAt")
      .sort({ createdAt: -1 });

    if (existingActive) {
      return res.status(409).json({
        message:
          "You already have an active job being processed. Please complete it before requesting another.",
        code: "CUSTOMER_ALREADY_HAS_ACTIVE_JOB",
        activeJob: {
          id: existingActive._id,
          status: existingActive.status,
          createdAt: existingActive.createdAt,
        },
      });
    }

    const {
      title,
      description,
      roleNeeded,
      pickupLat,
      pickupLng,
      pickupAddressText,
      dropoffLat,
      dropoffLng,
      dropoffAddressText,
      towTruckTypeNeeded,
      vehicleType,
    } = req.body;

    if (!title || !roleNeeded || pickupLat === undefined || pickupLng === undefined) {
      return res.status(400).json({
        message: "title, roleNeeded, pickupLat, pickupLng are required",
      });
    }

    if (
      roleNeeded === USER_ROLES.TOW_TRUCK &&
      (dropoffLat === undefined || dropoffLng === undefined)
    ) {
      return res.status(400).json({
        message: "TowTruck jobs require dropoffLat and dropoffLng",
      });
    }

    const normalizedTowTruckTypeNeeded = towTruckTypeNeeded
      ? normalizeTowTruckType(towTruckTypeNeeded)
      : null;

    const providers = await findNearbyProviders({
      roleNeeded,
      pickupLng,
      pickupLat,
      towTruckTypeNeeded: normalizedTowTruckTypeNeeded,
      vehicleType,
      excludedProviders: [],
      maxDistanceMeters: 20000,
      limit: 10,
    });

    if (!providers || providers.length === 0) {
      return res.status(400).json({
        message: "No providers online within range. Cannot create job.",
      });
    }

    const distanceKm =
      roleNeeded === USER_ROLES.TOW_TRUCK &&
      dropoffLat !== undefined &&
      dropoffLng !== undefined
        ? haversineDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng)
        : 0;

    const pricing = await calculateJobPricing({
      roleNeeded,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      towTruckTypeNeeded: normalizedTowTruckTypeNeeded,
      vehicleType,
      distanceKm,
    });

    const hasDropoff = dropoffLat !== undefined && dropoffLng !== undefined;

    const paymentMode =
      roleNeeded === USER_ROLES.TOW_TRUCK ? "DIRECT_TO_PROVIDER" : "PAY_AFTER_SERVICE";

    const job = await Job.create({
      title,
      description,
      roleNeeded,
      pickupLocation: { type: "Point", coordinates: [pickupLng, pickupLat] },
      pickupAddressText: pickupAddressText || null,
      dropoffLocation: hasDropoff
        ? { type: "Point", coordinates: [dropoffLng, dropoffLat] }
        : undefined,
      dropoffAddressText: hasDropoff ? dropoffAddressText : undefined,
      towTruckTypeNeeded: normalizedTowTruckTypeNeeded || null,
      vehicleType: vehicleType || null,
      customer: req.user._id,
      status: JOB_STATUSES.CREATED,
      paymentMode,
      pricing: {
        ...pricing,
        bookingFeeStatus: "PENDING",
        bookingFeePaidAt: null,
        bookingFeeRefundedAt: null,
      },
    });

    const payment = await Payment.create({
      job: job._id,
      customer: req.user._id,
      amount: pricing.bookingFee,
      currency: pricing.currency,
      status: PAYMENT_STATUSES.PENDING,
      provider: "SIMULATION",
    });

    return res.status(201).json({
      message: `Job created ✅ Providers found: ${providers.length}. Booking fee required.`,
      job,
      payment,
    });
  } catch (err) {
    console.error("❌ CREATE JOB ERROR:", err);
    return res.status(500).json({
      message: "Could not create job",
      error: err.message,
    });
  }
});

/* ============================================================
   ✅ NEW: CLEANUP ROUTE FOR UNPAID CREATED JOBS
   ============================================================ */

/**
 * ✅ Customer cancels/deletes a CREATED (unpaid draft) job
 * DELETE /api/jobs/:id/draft
 */
router.delete("/:id/draft", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.customer?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }

    if (job.status !== JOB_STATUSES.CREATED) {
      return res.status(400).json({
        message: "Only CREATED (unpaid) jobs can be deleted with this route",
        status: job.status,
      });
    }

    await Payment.updateMany(
      { job: job._id, status: PAYMENT_STATUSES.PENDING },
      { $set: { status: PAYMENT_STATUSES.CANCELLED } }
    );

    await Job.findByIdAndDelete(job._id);

    return res.status(200).json({
      message: "Draft job deleted ✅",
      jobId: req.params.id,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Could not delete draft job",
      error: err.message,
    });
  }
});

/* ============================================================
   ✅✅✅ ADDITIONS (NO DELETIONS): CUSTOMER "MY JOBS" ROUTES
   ============================================================ */

router.get("/my/active", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const activeStatuses = [
      JOB_STATUSES.CREATED,
      JOB_STATUSES.BROADCASTED,
      JOB_STATUSES.ASSIGNED,
      JOB_STATUSES.IN_PROGRESS,
    ];

    const jobs = await Job.find({
      customer: req.user._id,
      status: { $in: activeStatuses },
    })
      .sort({ createdAt: -1 })
      .populate("customer", "name email role phone")
      .populate("assignedTo", "name email role phone providerProfile")
      .limit(50);

    return res.status(200).json({ jobs });
  } catch (err) {
    console.error("❌ MY ACTIVE JOBS ERROR:", err);
    return res.status(500).json({
      message: "Could not fetch active jobs",
      error: err.message,
    });
  }
});

router.get("/my/history", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const historyStatuses = [JOB_STATUSES.COMPLETED, JOB_STATUSES.CANCELLED];

    const jobs = await Job.find({
      customer: req.user._id,
      status: { $in: historyStatuses },
    })
      .sort({ createdAt: -1 })
      .populate("customer", "name email role phone")
      .populate("assignedTo", "name email role phone providerProfile")
      .limit(100);

    return res.status(200).json({ jobs });
  } catch (err) {
    console.error("❌ MY JOB HISTORY ERROR:", err);
    return res.status(500).json({
      message: "Could not fetch job history",
      error: err.message,
    });
  }
});

router.get("/customer/active", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const activeStatuses = [
      JOB_STATUSES.CREATED,
      JOB_STATUSES.BROADCASTED,
      JOB_STATUSES.ASSIGNED,
      JOB_STATUSES.IN_PROGRESS,
    ];

    const jobs = await Job.find({
      customer: req.user._id,
      status: { $in: activeStatuses },
    })
      .sort({ createdAt: -1 })
      .populate("customer", "name email role phone")
      .populate("assignedTo", "name email role phone providerProfile")
      .limit(50);

    return res.status(200).json({ jobs });
  } catch (err) {
    console.error("❌ CUSTOMER ACTIVE (ALIAS) ERROR:", err);
    return res.status(500).json({
      message: "Could not fetch customer active jobs",
      error: err.message,
    });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate("customer", "name email role phone")
      .populate("assignedTo", "name email role phone providerProfile");

    if (!job) return res.status(404).json({ message: "Job not found" });

    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role);

    const isOwner =
      job.customer?._id?.toString() === req.user._id.toString() ||
      job.customer?.toString?.() === req.user._id.toString();

    const isAssignedProvider =
      job.assignedTo?._id?.toString() === req.user._id.toString() ||
      job.assignedTo?.toString?.() === req.user._id.toString();

    if (!isAdmin && !isOwner && !isAssignedProvider) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const safeJob = job.toObject({ virtuals: true });

    let providerLocation = null;
    let providerLastSeenAt = null;

    const coords = safeJob?.assignedTo?.providerProfile?.location?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);

      if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
        safeJob.assignedTo.lat = lat;
        safeJob.assignedTo.lng = lng;
        safeJob.assignedTo.location = { lat, lng };

        providerLocation = safeJob.assignedTo.providerProfile.location;
        providerLastSeenAt = safeJob.assignedTo.providerProfile.lastSeenAt || null;
      }
    }

    safeJob.providerLocation = providerLocation;
    safeJob.providerLastSeenAt = providerLastSeenAt;

    console.log("🛰️ GET /api/jobs/:id TRACKING DEBUG", {
      jobId: safeJob._id?.toString(),
      status: safeJob.status,
      assignedToId: safeJob.assignedTo?._id?.toString(),
      providerLocation: safeJob.providerLocation,
      providerLastSeenAt: safeJob.providerLastSeenAt,
    });

    return res.status(200).json({ job: safeJob });
  } catch (err) {
    console.error("❌ GET JOB ERROR:", err);
    return res.status(500).json({
      message: "Failed to fetch job",
      error: err.message,
    });
  }
});

/* ============================================================
   ✅ NEW: CUSTOMER CANCEL ROUTE WITH REFUND RULES
   ============================================================ */

router.patch("/:id/cancel", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.customer?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not allowed: job not yours" });
    }

    if (job.status === JOB_STATUSES.COMPLETED) {
      return res.status(400).json({ message: "Cannot cancel a completed job" });
    }

    if (job.status === JOB_STATUSES.CANCELLED) {
      return res.status(400).json({ message: "Job already cancelled" });
    }

    const nowMs = Date.now();
    const assignedAtMs = job.lockedAt ? new Date(job.lockedAt).getTime() : null;

    let refundBookingFee = false;
    let refundReason = null;

    if (job.status === JOB_STATUSES.ASSIGNED && assignedAtMs) {
      const elapsed = nowMs - assignedAtMs;

      if (elapsed <= CUSTOMER_CANCEL_REFUND_WINDOW_MS) {
        refundBookingFee = true;
        refundReason = "cancel_within_3_minutes";
      } else if (elapsed >= PROVIDER_NO_SHOW_REFUND_WINDOW_MS) {
        refundBookingFee = true;
        refundReason = "provider_no_show_45_minutes";
      } else {
        refundBookingFee = false;
        refundReason = "cancel_after_3_minutes_no_refund";
      }
    } else if (job.status === JOB_STATUSES.ASSIGNED && !assignedAtMs) {
      refundBookingFee = false;
      refundReason = "missing_lockedAt_no_refund";
    } else if (job.status === JOB_STATUSES.BROADCASTED) {
      refundBookingFee = false;
      refundReason = "cancel_broadcasted_no_refund_rule";
    } else if (job.status === JOB_STATUSES.IN_PROGRESS) {
      refundBookingFee = false;
      refundReason = "cancel_in_progress_no_refund";
    } else if (job.status === JOB_STATUSES.CREATED) {
      return res.status(400).json({
        message: "This job is still a draft (CREATED). Use DELETE /api/jobs/:id/draft instead.",
        code: "USE_DRAFT_DELETE",
      });
    }

    job.status = JOB_STATUSES.CANCELLED;
    job.cancelledBy = req.user._id;
    job.cancelReason = req.body?.reason || "Cancelled by customer";
    job.cancelledAt = new Date();

    if (job.pricing) {
      if (refundBookingFee) {
        job.pricing.bookingFeeStatus = "REFUND_REQUESTED";
        job.pricing.bookingFeeRefundedAt = new Date();
      } else {
        job.pricing.bookingFeeStatus = job.pricing.bookingFeeStatus || "PENDING";
      }
    }

    await job.save();

    const payment = await Payment.findOne({ job: job._id }).sort({ createdAt: -1 });

    if (payment) {
      if (refundBookingFee) {
        payment.status = PAYMENT_STATUSES.REFUNDED || PAYMENT_STATUSES.CANCELLED;
        await payment.save();
      } else {
        if (payment.status === PAYMENT_STATUSES.PENDING) {
          payment.status = PAYMENT_STATUSES.CANCELLED;
          await payment.save();
        }
      }
    }

    return res.status(200).json({
      message: "Job cancelled ✅",
      job,
      refund: {
        bookingFeeRefunded: refundBookingFee,
        reason: refundReason,
        windows: {
          cancelRefundWindowMinutes: 3,
          providerNoShowRefundMinutes: 45,
        },
      },
    });
  } catch (err) {
    console.error("❌ CUSTOMER CANCEL ERROR:", err);
    return res.status(500).json({
      message: "Could not cancel job",
      error: err.message,
    });
  }
});

/**
 * ✅ UPDATE JOB STATUS
 * PATCH /api/jobs/:id/status
 *
 * ✅ NEW ENFORCEMENT:
 * - Provider can only start job (ASSIGNED -> IN_PROGRESS)
 *   when within 30 meters of pickup location.
 */
router.patch("/:id/status", auth, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ message: "status is required" });

    const allowed = Object.values(JOB_STATUSES);
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status", allowed });
    }

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const isProvider = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK].includes(req.user.role);
    const isCustomer = req.user.role === USER_ROLES.CUSTOMER;

    if (isProvider) {
      if (!job.assignedTo || job.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Not allowed: job not assigned to you" });
      }

      const current = job.status;

      const ok =
        (current === JOB_STATUSES.ASSIGNED && status === JOB_STATUSES.IN_PROGRESS) ||
        (current === JOB_STATUSES.IN_PROGRESS && status === JOB_STATUSES.COMPLETED);

      if (!ok) {
        return res.status(400).json({
          message: "Invalid provider status transition",
          current,
          attempted: status,
          allowedTransitions: ["ASSIGNED -> IN_PROGRESS", "IN_PROGRESS -> COMPLETED"],
        });
      }

      /**
       * ✅ NEW: Start-job distance enforcement
       */
      if (current === JOB_STATUSES.ASSIGNED && status === JOB_STATUSES.IN_PROGRESS) {
        const pickupCoords = job?.pickupLocation?.coordinates; // [lng, lat]
        if (!Array.isArray(pickupCoords) || pickupCoords.length < 2) {
          return res.status(400).json({
            code: "PICKUP_LOCATION_MISSING",
            message: "Pickup location is missing. Cannot start job.",
          });
        }

        const pickupLng = Number(pickupCoords[0]);
        const pickupLat = Number(pickupCoords[1]);

        if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
          return res.status(400).json({
            code: "PICKUP_LOCATION_INVALID",
            message: "Pickup location is invalid. Cannot start job.",
            pickupCoords,
          });
        }

        // Provider current GPS from profile
        const me = await User.findById(req.user._id).select("providerProfile.location");
        const myCoords = me?.providerProfile?.location?.coordinates; // [lng, lat]

        if (!Array.isArray(myCoords) || myCoords.length < 2) {
          return res.status(409).json({
            code: "PROVIDER_GPS_MISSING",
            message: "Your GPS location is missing. Turn on location and try again.",
          });
        }

        const myLng = Number(myCoords[0]);
        const myLat = Number(myCoords[1]);

        if (!Number.isFinite(myLat) || !Number.isFinite(myLng) || (myLat === 0 && myLng === 0)) {
          return res.status(409).json({
            code: "PROVIDER_GPS_INVALID",
            message: "Your GPS location is invalid. Refresh location and try again.",
          });
        }

        const distMeters = haversineDistanceMeters(myLat, myLng, pickupLat, pickupLng);

        if (distMeters > START_JOB_MAX_DISTANCE_METERS) {
          return res.status(409).json({
            code: "TOO_FAR_FROM_PICKUP",
            message: `You must be within ${START_JOB_MAX_DISTANCE_METERS} meters of pickup to start this job.`,
            distanceMeters: distMeters,
            maxAllowedMeters: START_JOB_MAX_DISTANCE_METERS,
          });
        }

        console.log("✅ Start-job allowed (within pickup radius)", {
          providerId: req.user._id.toString(),
          jobId: job._id.toString(),
          distanceMeters: distMeters,
          maxAllowedMeters: START_JOB_MAX_DISTANCE_METERS,
        });
      }

      job.status = status;
      await job.save();

      return res.status(200).json({
        message: "Job status updated ✅",
        job,
      });
    }

    if (isCustomer) {
      if (job.customer?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Not allowed: job not yours" });
      }

      if (status !== JOB_STATUSES.CANCELLED) {
        return res.status(403).json({ message: "Customer can only cancel jobs" });
      }

      if ([JOB_STATUSES.COMPLETED].includes(job.status)) {
        return res.status(400).json({ message: "Cannot cancel a completed job" });
      }

      job.status = JOB_STATUSES.CANCELLED;
      job.cancelledBy = req.user._id;
      job.cancelReason = req.body.reason || "Cancelled by customer";
      job.cancelledAt = new Date();

      await job.save();

      return res.status(200).json({
        message: "Job cancelled ✅",
        job,
      });
    }

    return res.status(403).json({ message: "Role not allowed" });
  } catch (err) {
    console.error("❌ UPDATE STATUS ERROR:", err);
    return res.status(500).json({
      message: "Could not update job status",
      error: err.message,
    });
  }
});

/**
 * ✅ RATE JOB
 * POST /api/jobs/rate
 * Body: { jobId, rating, comment }
 */
router.post("/rate", auth, async (req, res) => {
  try {
    const { jobId, rating, comment } = req.body || {};
    if (!jobId) return res.status(400).json({ message: "jobId is required" });

    const stars = Number(rating);
    if (!stars || stars < 1 || stars > 5) {
      return res.status(400).json({ message: "rating must be 1..5" });
    }

    const text = comment ? String(comment).trim().slice(0, 200) : null;

    const job = await Job.findById(jobId).populate("customer").populate("assignedTo");
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.status !== JOB_STATUSES.COMPLETED) {
      return res.status(400).json({ message: "Job must be COMPLETED before rating" });
    }

    const me = await User.findById(req.user._id);
    if (!me) return res.status(401).json({ message: "User not found" });

    const myRole = me.role;
    const isCustomer = myRole === USER_ROLES.CUSTOMER;
    const isProvider = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK].includes(myRole);

    if (!isCustomer && !isProvider) {
      return res.status(403).json({ message: "Role not allowed to rate" });
    }

    let targetUserId = null;
    let targetRole = null;

    if (isCustomer) {
      if (!job.assignedTo) {
        return res.status(400).json({ message: "Cannot rate: no provider assigned" });
      }
      targetUserId = job.assignedTo._id;
      targetRole = job.assignedTo.role;
    } else {
      if (!job.customer) {
        return res.status(400).json({ message: "Cannot rate: missing job customer" });
      }
      targetUserId = job.customer._id;
      targetRole = USER_ROLES.CUSTOMER;
    }

    const existing = await Rating.findOne({ job: job._id, rater: me._id });
    if (existing) return res.status(409).json({ message: "You already rated this job" });

    await Rating.create({
      job: job._id,
      rater: me._id,
      target: targetUserId,
      raterRole: myRole,
      targetRole,
      rating: stars,
      comment: text,
    });

    await recomputeUserRatingStats(targetUserId);

    return res.status(201).json({
      success: true,
      message: "Rating submitted ✅",
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ message: "You already rated this job" });
    }

    console.error("❌ RATE JOB ERROR:", err);
    return res.status(500).json({
      message: "Could not submit rating",
      error: err.message,
    });
  }
});

export default router;