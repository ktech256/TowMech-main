import express from "express";
import mongoose from "mongoose"; // ✅ ADDED (needed for aggregation ObjectId)
import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";
import Rating from "../models/Rating.js"; // ✅ ADDED (3.1)
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
 * ✅ Helper: Recompute rating stats for a target user (3.2)
 */
async function recomputeUserRatingStats(userId) {
  const targetId = new mongoose.Types.ObjectId(userId);

  // Provider stats: toRole != "Customer"
  const providerAgg = await Rating.aggregate([
    { $match: { toUser: targetId, toRole: { $ne: "Customer" } } },
    { $group: { _id: "$toUser", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  // Customer stats: toRole == "Customer"
  const customerAgg = await Rating.aggregate([
    { $match: { toUser: targetId, toRole: "Customer" } },
    { $group: { _id: "$toUser", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
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

  const R = 6371; // Earth radius in km
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

      // ✅ Load PricingConfig
      let config = await PricingConfig.findOne();
      if (!config) config = await PricingConfig.create({});

      let towTruckTypes = config.towTruckTypes || [];

      // ✅ FIX: Ensure towTruckTypes is never empty
      if (!towTruckTypes || towTruckTypes.length === 0) {
        console.log("⚠️ towTruckTypes empty → setting defaults...");

        config.towTruckTypes = [
          "Flatbed",
          "TowTruck",
          "Rollback",
          "TowTruck-XL",
          "TowTruck-XXL",
          "Recovery",
        ];

        await config.save();
        towTruckTypes = config.towTruckTypes;
      }

      console.log("✅ towTruckTypes:", towTruckTypes);

      // ✅ Compute distance (TowTruck jobs only)
      const distanceKm =
        roleNeeded === USER_ROLES.TOW_TRUCK &&
        dropoffLat !== undefined &&
        dropoffLng !== undefined
          ? haversineDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng)
          : 0;

      /**
       * ✅ CASE 1: towTruckTypeNeeded provided → return single preview result
       */
      if (towTruckTypeNeeded) {
        const pricing = await calculateJobPricing({
          roleNeeded,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          towTruckTypeNeeded,
          vehicleType,
          distanceKm,
        });

        const providers = await findNearbyProviders({
          roleNeeded,
          pickupLng,
          pickupLat,
          towTruckTypeNeeded,
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

      /**
       * ✅ CASE 2: towTruckTypeNeeded missing
       */
      const resultsByTowTruckType = {};

      for (const type of towTruckTypes) {
        const pricing = await calculateJobPricing({
          roleNeeded,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          towTruckTypeNeeded: type,
          vehicleType,
          distanceKm,
        });

        const providersForType = await findNearbyProviders({
          roleNeeded,
          pickupLng,
          pickupLat,
          towTruckTypeNeeded: type,
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

    const providers = await findNearbyProviders({
      roleNeeded,
      pickupLng,
      pickupLat,
      towTruckTypeNeeded,
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
      towTruckTypeNeeded,
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
      towTruckTypeNeeded: towTruckTypeNeeded || null,
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

/**
 * ✅ UPDATE JOB STATUS
 * PATCH /api/jobs/:id/status
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
 * ✅ RATE JOB (3.3)
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

    let toUser = null;
    let toRole = null;

    if (isCustomer) {
      if (!job.assignedTo) {
        return res.status(400).json({ message: "Cannot rate: no provider assigned" });
      }
      toUser = job.assignedTo._id;
      toRole = job.assignedTo.role;
    } else {
      if (!job.customer) {
        return res.status(400).json({ message: "Cannot rate: missing job customer" });
      }
      toUser = job.customer._id;
      toRole = USER_ROLES.CUSTOMER;
    }

    const existing = await Rating.findOne({ job: job._id, fromUser: me._id });
    if (existing) {
      return res.status(409).json({ message: "You already rated this job" });
    }

    await Rating.create({
      job: job._id,
      fromUser: me._id,
      toUser,
      fromRole: myRole,
      toRole,
      rating: stars,
      comment: text,
    });

    await recomputeUserRatingStats(toUser);

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