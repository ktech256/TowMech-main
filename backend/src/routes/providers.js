import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";

const router = express.Router();

/**
 * ✅ Provider updates online/offline + current location
 * PATCH /api/providers/me/status
 */
router.patch("/me/status", auth, async (req, res) => {
  try {
    const { isOnline, lat, lng, towTruckTypes, carTypesSupported } = req.body;

    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only service providers can update status" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.providerProfile) user.providerProfile = {};

    // ✅ ALWAYS UPDATE LOCATION FIRST
    if (lat !== undefined && lng !== undefined) {
      user.providerProfile.location = {
        type: "Point",
        coordinates: [lng, lat],
      };
    }

    user.providerProfile.lastSeenAt = new Date();

    if (Array.isArray(towTruckTypes)) user.providerProfile.towTruckTypes = towTruckTypes;
    if (Array.isArray(carTypesSupported)) user.providerProfile.carTypesSupported = carTypesSupported;

    if (typeof isOnline === "boolean") {
      if (isOnline === true) {
        const status = user.providerProfile?.verificationStatus || "PENDING";

        if (status !== "APPROVED") {
          await user.save();
          return res.status(403).json({
            message: "Provider must be verified by admin before going online",
            verificationStatus: status,
            providerProfile: user.providerProfile
          });
        }
      }

      user.providerProfile.isOnline = isOnline;
    }

    await user.save();

    return res.status(200).json({
      message: "Provider status updated ✅",
      providerProfile: user.providerProfile,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Could not update provider status",
      error: err.message,
    });
  }
});

/**
 * ✅ NEW: Provider profile (fetch signup details)
 * GET /api/providers/me
 */
router.get("/me", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only service providers can access this profile" });
    }

    const user = await User.findById(req.user._id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({
      _id: user._id,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      name: user.name ?? null, // (in case your model uses name)
      email: user.email ?? null,
      phone: user.phone ?? null,
      role: user.role,
      providerProfile: user.providerProfile || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Could not fetch provider profile",
      error: err.message,
    });
  }
});

/**
 * ✅ NEW: Update provider details (ONLY email + phone)
 * PATCH /api/providers/me
 */
router.patch("/me", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only service providers can update profile" });
    }

    const { email, phone } = req.body;

    // ✅ ONLY allow these 2 fields
    const updates = {};
    if (typeof email === "string" && email.trim()) updates.email = email.trim().toLowerCase();
    if (typeof phone === "string" && phone.trim()) updates.phone = phone.trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ apply allowed updates only
    if (updates.email) user.email = updates.email;
    if (updates.phone) user.phone = updates.phone;

    await user.save();

    const fresh = await User.findById(req.user._id).select("-password");

    return res.status(200).json({
      _id: fresh._id,
      firstName: fresh.firstName ?? null,
      lastName: fresh.lastName ?? null,
      name: fresh.name ?? null,
      email: fresh.email ?? null,
      phone: fresh.phone ?? null,
      role: fresh.role,
      providerProfile: fresh.providerProfile || null,
      createdAt: fresh.createdAt,
      updatedAt: fresh.updatedAt,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Could not update provider profile",
      error: err.message,
    });
  }
});

/**
 * ✅ Provider fetches jobs broadcasted to them
 * GET /api/providers/jobs/broadcasted
 */
router.get("/jobs/broadcasted", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can view broadcasted jobs" });
    }

    const jobs = await Job.find({
      status: JOB_STATUSES.BROADCASTED,
      assignedTo: null,
      broadcastedTo: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: "Could not fetch broadcasted jobs", error: err.message });
  }
});

/**
 * ✅ NEW: Provider fetches a single broadcasted job by id
 * GET /api/providers/jobs/broadcasted/:jobId
 */
router.get("/jobs/broadcasted/:jobId", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can view broadcasted jobs" });
    }

    const job = await Job.findOne({
      _id: req.params.jobId,
      status: JOB_STATUSES.BROADCASTED,
      assignedTo: null,
      broadcastedTo: req.user._id,
    });

    if (!job) return res.status(404).json({ message: "Job not found or not available" });

    return res.status(200).json(job);
  } catch (err) {
    return res.status(500).json({ message: "Could not fetch job", error: err.message });
  }
});

/**
 * ✅ Provider accepts job (first accept wins)
 * PATCH /api/providers/jobs/:jobId/accept
 */
router.patch("/jobs/:jobId/accept", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can accept jobs" });
    }

    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.jobId,
        status: JOB_STATUSES.BROADCASTED,
        assignedTo: null,
        broadcastedTo: req.user._id,
      },
      {
        assignedTo: req.user._id,
        status: JOB_STATUSES.ASSIGNED,
        lockedAt: new Date(),
      },
      { new: true }
    );

    if (!job) {
      return res.status(409).json({ message: "Job already claimed or not available" });
    }

    return res.status(200).json({ message: "Job accepted", job });
  } catch (err) {
    return res.status(500).json({ message: "Could not accept job", error: err.message });
  }
});

/**
 * ✅ Provider rejects job (does not accept)
 * PATCH /api/providers/jobs/:jobId/reject
 */
router.patch("/jobs/:jobId/reject", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can reject jobs" });
    }

    const job = await Job.findOne({
      _id: req.params.jobId,
      status: JOB_STATUSES.BROADCASTED,
      assignedTo: null,
      broadcastedTo: req.user._id,
    });

    if (!job) {
      return res.status(404).json({ message: "Job not found or not available" });
    }

    job.broadcastedTo = job.broadcastedTo.filter((id) => id.toString() !== req.user._id.toString());

    if (!job.excludedProviders) job.excludedProviders = [];
    if (!job.excludedProviders.map(String).includes(req.user._id.toString())) {
      job.excludedProviders.push(req.user._id);
    }

    await job.save();

    return res.status(200).json({ message: "Job rejected", jobId: job._id });
  } catch (err) {
    return res.status(500).json({ message: "Could not reject job", error: err.message });
  }
});

/**
 * ✅ NEW: Provider fetches assigned (active) jobs
 * GET /api/providers/jobs/assigned
 */
router.get("/jobs/assigned", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can view assigned jobs" });
    }

    const jobs = await Job.find({
      assignedTo: req.user._id,
      status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] },
    })
      .sort({ updatedAt: -1 })
      .limit(20);

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: "Could not fetch assigned jobs", error: err.message });
  }
});

/**
 * ✅ NEW: Provider fetches job history
 * GET /api/providers/jobs/history
 */
router.get("/jobs/history", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can view job history" });
    }

    const jobs = await Job.find({
      assignedTo: req.user._id,
      status: JOB_STATUSES.COMPLETED,
    })
      .sort({ updatedAt: -1 })
      .limit(50);

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: "Could not fetch job history", error: err.message });
  }
});

/**
 * ✅ FIXED: Provider fetches a single job by id (assigned to them)
 * GET /api/providers/jobs/:jobId
 *
 * IMPORTANT FIX:
 * - Restrict :jobId to ObjectId regex so it does NOT catch /jobs/assigned or /jobs/history.
 */
router.get("/jobs/:jobId([0-9a-fA-F]{24})", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can view provider jobs" });
    }

    const job = await Job.findOne({
      _id: req.params.jobId,
      assignedTo: req.user._id,
    }).populate("customer", "name email phone");

    if (!job) return res.status(404).json({ message: "Job not found" });

    return res.status(200).json(job);
  } catch (err) {
    return res.status(500).json({ message: "Could not fetch job", error: err.message });
  }
});

/**
 * ✅ Provider cancels job → job is re-broadcasted automatically
 * PATCH /api/providers/jobs/:jobId/cancel
 */
router.patch("/jobs/:jobId/cancel", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];

    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can cancel jobs" });
    }

    const job = await Job.findById(req.params.jobId);

    if (!job) return res.status(404).json({ message: "Job not found" });

    if (!job.assignedTo || job.assignedTo.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to cancel this job" });
    }

    if (job.status === JOB_STATUSES.COMPLETED) {
      return res.status(400).json({ message: "Cannot cancel a completed job" });
    }

    if (!job.excludedProviders) job.excludedProviders = [];
    if (!job.excludedProviders.map(String).includes(req.user._id.toString())) {
      job.excludedProviders.push(req.user._id);
    }

    job.assignedTo = null;
    job.lockedAt = null;
    job.status = JOB_STATUSES.BROADCASTED;
    job.broadcastedTo = [];

    job.cancelledBy = req.user._id;
    job.cancelReason = req.body.reason || "Cancelled by provider";
    job.cancelledAt = new Date();

    await job.save();

    const newProviders = await User.find({
      role: job.roleNeeded,
      "providerProfile.isOnline": true,
      _id: { $nin: job.excludedProviders },
    }).limit(10);

    job.broadcastedTo = newProviders.map((p) => p._id);

    job.dispatchAttempts = job.dispatchAttempts || [];
    newProviders.forEach((p) => {
      job.dispatchAttempts.push({
        providerId: p._id,
        attemptedAt: new Date(),
      });
    });

    await job.save();

    return res.status(200).json({
      message: "Provider cancelled. Job rebroadcasted.",
      job,
      broadcastedTo: job.broadcastedTo,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Could not cancel and rebroadcast job",
      error: err.message,
    });
  }
});

export default router;