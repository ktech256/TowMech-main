import express from "express";
import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";
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
 * ✅ PREVIEW JOB (NO PAYMENT CREATED)
 * ✅ Calculates estimate + checks if providers exist
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
        vehicleType
      } = req.body;

      if (!title || !roleNeeded || pickupLat === undefined || pickupLng === undefined) {
        return res.status(400).json({
          message: "title, roleNeeded, pickupLat, pickupLng are required"
        });
      }

      if (
        roleNeeded === USER_ROLES.TOW_TRUCK &&
        (dropoffLat === undefined || dropoffLng === undefined)
      ) {
        return res.status(400).json({
          message: "TowTruck jobs require dropoffLat and dropoffLng"
        });
      }

      // ✅ ONE pricing function handles everything now
      const pricing = await calculateJobPricing({
        roleNeeded,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        towTruckTypeNeeded,
        vehicleType
      });

      const providers = await findNearbyProviders({
        roleNeeded,
        pickupLng,
        pickupLat,
        towTruckTypeNeeded,
        vehicleType,
        excludedProviders: [],
        maxDistanceMeters: 20000,
        limit: 10
      });

      if (!providers || providers.length === 0) {
        return res.status(200).json({
          providersFound: false,
          providerCount: 0,
          message: "No providers online within range. Booking fee not required.",
          preview: pricing
        });
      }

      return res.status(200).json({
        providersFound: true,
        providerCount: providers.length,
        message: "Providers found ✅ Please pay booking fee to proceed",
        preview: pricing
      });

    } catch (err) {
      console.error("❌ PREVIEW ERROR:", err);
      return res.status(500).json({
        message: "Could not preview job",
        error: err.message
      });
    }
  }
);

/**
 * ✅ CUSTOMER creates job
 * ✅ Only allowed if providers exist nearby
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
      vehicleType
    } = req.body;

    if (!title || !roleNeeded || pickupLat === undefined || pickupLng === undefined) {
      return res.status(400).json({
        message: "title, roleNeeded, pickupLat, pickupLng are required"
      });
    }

    if (
      roleNeeded === USER_ROLES.TOW_TRUCK &&
      (dropoffLat === undefined || dropoffLng === undefined)
    ) {
      return res.status(400).json({
        message: "TowTruck jobs require dropoffLat and dropoffLng"
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
      limit: 10
    });

    if (!providers || providers.length === 0) {
      return res.status(400).json({
        message: "No providers online within range. Cannot create job."
      });
    }

    // ✅ Pricing using calculateJobPricing()
    const pricing = await calculateJobPricing({
      roleNeeded,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      towTruckTypeNeeded,
      vehicleType
    });

    const hasDropoff = dropoffLat !== undefined && dropoffLng !== undefined;

    const paymentMode =
      roleNeeded === USER_ROLES.TOW_TRUCK
        ? "DIRECT_TO_PROVIDER"
        : "PAY_AFTER_SERVICE";

    // ✅ CREATE JOB
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
        bookingFeeRefundedAt: null
      }
    });

    // ✅ CREATE PAYMENT (SIMULATION)
    const payment = await Payment.create({
      job: job._id,
      customer: req.user._id,
      amount: pricing.bookingFee,
      currency: pricing.currency,
      status: PAYMENT_STATUSES.PENDING,
      provider: "SIMULATION"
    });

    return res.status(201).json({
      message: `Job created ✅ Providers found: ${providers.length}. Booking fee required.`,
      job,
      payment
    });

  } catch (err) {
    console.error("❌ CREATE JOB ERROR:", err);
    return res.status(500).json({
      message: "Could not create job",
      error: err.message
    });
  }
});

/**
 * ✅ CUSTOMER - GET ACTIVE JOBS
 * ✅ GET /api/jobs/my/active
 */
router.get("/my/active", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const jobs = await Job.find({
      customer: req.user._id,
      status: { $in: [JOB_STATUSES.CREATED, JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] }
    }).sort({ createdAt: -1 });

    return res.status(200).json({ jobs });
  } catch (err) {
    console.error("❌ CUSTOMER ACTIVE JOBS ERROR:", err);
    return res.status(500).json({
      message: "Failed to load active jobs",
      error: err.message
    });
  }
});

/**
 * ✅ CUSTOMER - GET JOB HISTORY
 * ✅ GET /api/jobs/my/history
 */
router.get("/my/history", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const jobs = await Job.find({
      customer: req.user._id,
      status: { $in: [JOB_STATUSES.COMPLETED, JOB_STATUSES.CANCELLED] }
    }).sort({ createdAt: -1 });

    return res.status(200).json({ jobs });
  } catch (err) {
    console.error("❌ CUSTOMER JOB HISTORY ERROR:", err);
    return res.status(500).json({
      message: "Failed to load job history",
      error: err.message
    });
  }
});

/**
 * ✅ Provider sees available jobs broadcasted to them
 * GET /api/jobs/available
 */
router.get("/available", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only service providers can view available jobs" });
    }

    const jobs = await Job.find({
      status: JOB_STATUSES.BROADCASTED,
      assignedTo: null,
      broadcastedTo: req.user._id
    }).sort({ createdAt: -1 });

    return res.status(200).json(jobs);
  } catch (err) {
    return res.status(500).json({ message: "Could not fetch available jobs", error: err.message });
  }
});

/**
 * ✅ Provider accepts broadcasted job
 * PATCH /api/jobs/:id/accept
 */
router.patch("/:id/accept", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only service providers can accept jobs" });
    }

    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.id,
        status: JOB_STATUSES.BROADCASTED,
        assignedTo: null,
        broadcastedTo: req.user._id
      },
      {
        assignedTo: req.user._id,
        lockedAt: new Date(),
        status: JOB_STATUSES.ASSIGNED
      },
      { new: true }
    );

    if (!job) {
      return res.status(409).json({
        message: "Job already accepted or not available to you"
      });
    }

    const populatedJob = await Job.findById(job._id)
      .populate("customer", "name email")
      .populate("assignedTo", "name email");

    if (populatedJob?.customer?.email) {
      await sendJobAcceptedEmail({
        to: populatedJob.customer.email,
        name: populatedJob.customer.name,
        job: populatedJob,
        recipientType: "CUSTOMER"
      });
    }

    if (populatedJob?.assignedTo?.email) {
      await sendJobAcceptedEmail({
        to: populatedJob.assignedTo.email,
        name: populatedJob.assignedTo.name,
        job: populatedJob,
        recipientType: "PROVIDER"
      });
    }

    return res.status(200).json({ message: "Job accepted ✅", job });
  } catch (err) {
    return res.status(500).json({ message: "Could not accept job", error: err.message });
  }
});

/**
 * ✅ Update job status
 * PATCH /api/jobs/:id/status
 */
router.patch("/:id/status", auth, async (req, res) => {
  try {
    const { status } = req.body;

    if (!Object.values(JOB_STATUSES).includes(status)) {
      return res.status(400).json({ message: "Invalid status provided" });
    }

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const isAssignedProvider =
      job.assignedTo && job.assignedTo.toString() === req.user._id.toString();

    const isAdmin = req.user.role === USER_ROLES.ADMIN;

    if (!isAssignedProvider && !isAdmin) {
      return res.status(403).json({
        message: "Only assigned provider or admin can update job status"
      });
    }

    job.status = status;
    await job.save();

    if (status === JOB_STATUSES.COMPLETED) {
      const populatedJob = await Job.findById(job._id)
        .populate("customer", "name email")
        .populate("assignedTo", "name email");

      if (populatedJob?.customer?.email) {
        await sendJobCompletedEmail({
          to: populatedJob.customer.email,
          name: populatedJob.customer.name,
          job: populatedJob,
          recipientType: "CUSTOMER"
        });
      }

      if (populatedJob?.assignedTo?.email) {
        await sendJobCompletedEmail({
          to: populatedJob.assignedTo.email,
          name: populatedJob.assignedTo.name,
          job: populatedJob,
          recipientType: "PROVIDER"
        });
      }
    }

    return res.status(200).json({ message: "Job status updated ✅", job });
  } catch (err) {
    return res.status(500).json({ message: "Could not update job status", error: err.message });
  }
});

export default router;