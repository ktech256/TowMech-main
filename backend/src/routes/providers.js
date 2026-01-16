// routes/providers.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";

// ✅✅✅ ADDED (for documents upload)
import multer from "multer";
import { uploadToFirebase } from "../utils/uploadToFirebase.js";

// ✅✅✅ ADDED (push helpers)
import { sendPushToManyUsers } from "../utils/sendPush.js";

const router = express.Router();

// ✅✅✅ ADDED (multer memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
});

/**
 * ✅ NEW: Provider cancel window (2 minutes)
 */
const PROVIDER_CANCEL_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

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
 * ✅ Provider updates current GPS location (for customer tracking)
 * PATCH /api/providers/location
 */
router.patch("/location", auth, async (req, res) => {
  try {
    const { lat, lng } = req.body || {};

    console.log("📍 /api/providers/location HIT", {
      userId: req.user?._id?.toString(),
      lat,
      lng,
    });

    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can update location" });
    }

    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        message: "Invalid location coordinates",
        lat,
        lng,
      });
    }

    if (latitude === 0 && longitude === 0) {
      return res.status(400).json({
        message: "Invalid GPS (0,0) refused",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.providerProfile) user.providerProfile = {};

    user.providerProfile.location = {
      type: "Point",
      coordinates: [longitude, latitude], // [lng, lat]
    };

    user.providerProfile.lastSeenAt = new Date();

    await user.save();

    console.log("📍 Provider location updated:", user._id.toString(), latitude, longitude);

    return res.status(200).json({
      message: "Location updated ✅",
      location: user.providerProfile.location,
      lastSeenAt: user.providerProfile.lastSeenAt,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Could not update provider location",
      error: err.message,
    });
  }
});

/**
 * ✅ Provider profile (fetch what they registered with)
 * GET /api/providers/me
 */
router.get("/me", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can view this profile" });
    }

    const user = await User.findById(req.user._id).select(
      "name email phone role providerProfile createdAt updatedAt"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({ user });
  } catch (err) {
    return res.status(500).json({
      message: "Could not fetch provider profile",
      error: err.message,
    });
  }
});

/**
 * ✅ Provider profile update (ONLY email + phone editable)
 * PATCH /api/providers/me
 */
router.patch("/me", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can update this profile" });
    }

    const { email, phone } = req.body;

    const update = {};
    if (typeof email === "string") update.email = email.trim();
    if (typeof phone === "string") update.phone = phone.trim();

    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      runValidators: true,
    }).select("name email phone role providerProfile createdAt updatedAt");

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({ user });
  } catch (err) {
    return res.status(500).json({
      message: "Could not update provider profile",
      error: err.message,
    });
  }
});

/**
 * ✅✅✅ ADDED: Upload provider verification documents
 * PATCH /api/providers/me/documents
 */
router.patch(
  "/me/documents",
  auth,
  upload.fields([
    { name: "idDocument", maxCount: 1 },
    { name: "license", maxCount: 1 },
    { name: "vehicleProof", maxCount: 1 },
    { name: "workshopProof", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
      if (!providerRoles.includes(req.user.role)) {
        return res.status(403).json({ message: "Only providers can upload documents" });
      }

      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (!user.providerProfile) user.providerProfile = {};
      if (!user.providerProfile.verificationDocs)
        user.providerProfile.verificationDocs = {};

      const status = user.providerProfile.verificationStatus || "PENDING";

      if (status === "APPROVED") {
        return res.status(403).json({
          message: "Account already approved. Document upload disabled.",
          verificationStatus: status,
        });
      }

      const files = req.files || {};

      const uploadOne = async (file, keyName) => {
        if (!file) return null;

        const userId = user._id.toString();
        const ts = Date.now();
        const fileName = `providers/${userId}/${keyName}-${ts}-${file.originalname}`;

        return uploadToFirebase(file.buffer, fileName, file.mimetype);
      };

      const idDocFile = files.idDocument?.[0];
      const licenseFile = files.license?.[0];
      const vehicleProofFile = files.vehicleProof?.[0];
      const workshopProofFile = files.workshopProof?.[0];

      const idDocumentUrl = await uploadOne(idDocFile, "idDocument");
      const licenseUrl = await uploadOne(licenseFile, "license");
      const vehicleProofUrl = await uploadOne(vehicleProofFile, "vehicleProof");
      const workshopProofUrl = await uploadOne(workshopProofFile, "workshopProof");

      if (idDocumentUrl)
        user.providerProfile.verificationDocs.idDocumentUrl = idDocumentUrl;
      if (licenseUrl) user.providerProfile.verificationDocs.licenseUrl = licenseUrl;
      if (vehicleProofUrl)
        user.providerProfile.verificationDocs.vehicleProofUrl = vehicleProofUrl;
      if (workshopProofUrl)
        user.providerProfile.verificationDocs.workshopProofUrl = workshopProofUrl;

      if (status === "REJECTED") {
        user.providerProfile.verificationStatus = "PENDING";
        user.providerProfile.verifiedAt = null;
        user.providerProfile.verifiedBy = null;
      }

      await user.save();

      return res.status(200).json({
        message: "Documents uploaded ✅",
        user: await User.findById(user._id).select(
          "name email phone role providerProfile createdAt updatedAt"
        ),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not upload documents",
        error: err.message,
      });
    }
  }
);

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

    const storedCoords = user.providerProfile?.location?.coordinates;
    const storedLng = Array.isArray(storedCoords) ? Number(storedCoords[0]) : null;
    const storedLat = Array.isArray(storedCoords) ? Number(storedCoords[1]) : null;
    const hasStoredLocation =
      Array.isArray(storedCoords) &&
      storedCoords.length === 2 &&
      Number.isFinite(storedLng) &&
      Number.isFinite(storedLat);

    const isStoredZeroZero = hasStoredLocation && storedLng === 0 && storedLat === 0;

    const hasIncomingLatLng = lat !== undefined && lng !== undefined;
    const incomingLat = hasIncomingLatLng ? Number(lat) : null;
    const incomingLng = hasIncomingLatLng ? Number(lng) : null;

    if (hasIncomingLatLng) {
      if (!Number.isFinite(incomingLat) || !Number.isFinite(incomingLng)) {
        return res.status(400).json({
          message: "Invalid location coordinates",
          lat,
          lng,
        });
      }
    }

    if (typeof isOnline === "boolean" && isOnline === true) {
      const status = user.providerProfile?.verificationStatus || "PENDING";
      if (status !== "APPROVED") {
        await user.save();
        return res.status(403).json({
          message: "Provider must be verified by admin before going online",
          verificationStatus: status,
          providerProfile: user.providerProfile,
        });
      }

      if (hasIncomingLatLng && incomingLat === 0 && incomingLng === 0) {
        return res.status(400).json({
          message: "Cannot go ONLINE without a valid GPS location (lat/lng is 0,0).",
        });
      }

      if (!hasIncomingLatLng) {
        if (!hasStoredLocation || isStoredZeroZero) {
          return res.status(400).json({
            message:
              "Cannot go ONLINE without a valid GPS location. Please refresh location and try again.",
            storedLocation: hasStoredLocation ? storedCoords : null,
          });
        }
      }
    }

    if (hasIncomingLatLng) {
      user.providerProfile.location = {
        type: "Point",
        coordinates: [incomingLng, incomingLat],
      };
    }

    user.providerProfile.lastSeenAt = new Date();

    if (Array.isArray(towTruckTypes)) user.providerProfile.towTruckTypes = towTruckTypes;
    if (Array.isArray(carTypesSupported))
      user.providerProfile.carTypesSupported = carTypesSupported;

    if (typeof isOnline === "boolean") {
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
    return res.status(500).json({
      message: "Could not fetch broadcasted jobs",
      error: err.message,
    });
  }
});

/**
 * ✅ Provider fetches a single broadcasted job by id
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
 *
 * ✅ ENFORCEMENT:
 * - provider can have ONLY 1 active job at a time
 * - can accept ONE extra job only when within 3km of dropoff of current IN_PROGRESS job
 * - cannot accept more than 1 incoming job (so max total: 2 jobs where:
 *   - 1 is IN_PROGRESS
 *   - 1 is ASSIGNED (next))
 */
router.patch("/jobs/:jobId/accept", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can accept jobs" });
    }

    // ✅ Find provider active jobs (ASSIGNED/IN_PROGRESS)
    const activeJobs = await Job.find({
      assignedTo: req.user._id,
      status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] },
    }).select("status dropoffLocation pickupLocation title");

    const inProgress = activeJobs.filter((j) => j.status === JOB_STATUSES.IN_PROGRESS);
    const assigned = activeJobs.filter((j) => j.status === JOB_STATUSES.ASSIGNED);

    if (assigned.length >= 1) {
      return res.status(409).json({
        code: "PROVIDER_ALREADY_HAS_ASSIGNED_JOB",
        message: "You already have a pending assigned job. Finish it before accepting another.",
      });
    }

    if (activeJobs.length >= 2) {
      return res.status(409).json({
        code: "PROVIDER_MAX_ACTIVE_JOBS",
        message: "You already have active jobs. Finish them before accepting another.",
      });
    }

    if (inProgress.length >= 1) {
      const current = inProgress[0];

      const coords = current?.dropoffLocation?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) {
        return res.status(409).json({
          code: "CURRENT_JOB_HAS_NO_DROPOFF",
          message: "You cannot accept a new job because your current job has no dropoff location.",
        });
      }

      const dropoffLng = Number(coords[0]);
      const dropoffLat = Number(coords[1]);

      const me = await User.findById(req.user._id).select("providerProfile.location");
      const myCoords = me?.providerProfile?.location?.coordinates;

      if (!Array.isArray(myCoords) || myCoords.length < 2) {
        return res.status(409).json({
          code: "PROVIDER_GPS_MISSING",
          message: "Your GPS location is missing. Please turn on location and try again.",
        });
      }

      const myLng = Number(myCoords[0]);
      const myLat = Number(myCoords[1]);

      if (!Number.isFinite(myLat) || !Number.isFinite(myLng) || (myLat === 0 && myLng === 0)) {
        return res.status(409).json({
          code: "PROVIDER_GPS_INVALID",
          message: "Your GPS location is invalid. Please refresh location and try again.",
        });
      }

      const distKm = haversineDistanceKm(myLat, myLng, dropoffLat, dropoffLng);

      if (distKm > 3) {
        return res.status(409).json({
          code: "TOO_FAR_FROM_DROPOFF",
          message:
            "You can accept the next job only when you are within 3km of completing your current job.",
          distanceToDropoffKm: distKm,
          maxAllowedKm: 3,
        });
      }

      console.log("✅ Provider allowed to accept next job within 3km of dropoff", {
        providerId: req.user._id.toString(),
        distanceToDropoffKm: distKm,
      });
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
      return res.status(409).json({
        message: "Job already claimed or not available",
      });
    }

    const otherProviders = (job.broadcastedTo || [])
      .map((id) => id.toString())
      .filter((id) => id !== req.user._id.toString());

    if (otherProviders.length > 0) {
      await sendPushToManyUsers({
        userIds: otherProviders,
        title: "Job Taken",
        body: "This job has been accepted by another provider",
        data: {
          type: "job_cancelled",
          jobId: job._id.toString(),
          reason: "accepted_by_other",
        },
      });
    }

    return res.status(200).json({ message: "Job accepted", job });
  } catch (err) {
    return res.status(500).json({ message: "Could not accept job", error: err.message });
  }
});

/**
 * ✅ Provider rejects job
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

    job.broadcastedTo = job.broadcastedTo.filter(
      (id) => id.toString() !== req.user._id.toString()
    );

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
 * ✅ Provider assigned/active jobs
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
 * ✅ Provider job history
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
 * ✅ Provider fetches a single job by id (assigned to them)
 * GET /api/providers/jobs/:jobId
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
 *
 * ✅ NEW ENFORCEMENT:
 * - Only cancel when job.status === ASSIGNED
 * - Only within 2 minutes after lockedAt
 * - Cannot cancel IN_PROGRESS
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

    // ✅ Cannot cancel completed
    if (job.status === JOB_STATUSES.COMPLETED) {
      return res.status(400).json({ message: "Cannot cancel a completed job" });
    }

    // ✅ NEW: Cannot cancel started job
    if (job.status === JOB_STATUSES.IN_PROGRESS) {
      return res.status(403).json({
        code: "PROVIDER_CANNOT_CANCEL_IN_PROGRESS",
        message: "You cannot cancel a job that has already started.",
      });
    }

    // ✅ NEW: Only cancel if ASSIGNED
    if (job.status !== JOB_STATUSES.ASSIGNED) {
      return res.status(400).json({
        code: "PROVIDER_CANCEL_NOT_ALLOWED",
        message: "You can only cancel immediately after accepting the job (ASSIGNED).",
        status: job.status,
      });
    }

    // ✅ NEW: Enforce 2-minute cancel window using lockedAt
    const assignedAtMs = job.lockedAt ? new Date(job.lockedAt).getTime() : null;
    if (!assignedAtMs) {
      return res.status(400).json({
        code: "MISSING_LOCKED_AT",
        message: "Missing assignment time (lockedAt). Cannot validate cancel window.",
      });
    }

    const elapsedMs = Date.now() - assignedAtMs;
    if (elapsedMs > PROVIDER_CANCEL_WINDOW_MS) {
      return res.status(403).json({
        code: "PROVIDER_CANCEL_WINDOW_EXPIRED",
        message: "Cancel window expired (2 minutes). You can no longer cancel this job.",
        elapsedMs,
        allowedMs: PROVIDER_CANCEL_WINDOW_MS,
      });
    }

    // ✅ existing rebroadcast logic (kept)
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
      message: "Provider cancelled within 2 minutes. Job rebroadcasted ✅",
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