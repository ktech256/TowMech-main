// routes/providers.js
import express from "express";
import auth from "../middleware/auth.js";
import User, {
  USER_ROLES,
  TOW_TRUCK_TYPES,
  MECHANIC_CATEGORIES,
  VEHICLE_TYPES,
} from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";

// ✅ NEW: PricingConfig source of truth for dashboard-controlled categories/types
import PricingConfig from "../models/PricingConfig.js";

// ✅✅✅ ADDED (for documents upload)
import multer from "multer";
import { uploadToFirebase } from "../utils/uploadToFirebase.js";

// ✅✅✅ ADDED (push helpers)
import { sendPushToManyUsers } from "../utils/sendPush.js";
import { logAuditEvent } from "../utils/auditLogger.js";

// ✅ ADDED (for driver verification codes)
import DriverVerificationCode from "../models/DriverVerificationCode.js";
import Partner from "../models/Partner.js";

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
 * ✅ Helpers: normalize inputs
 */
function normalizeStringArray(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * ✅ NEW: Allowed types/categories should come from PricingConfig (dashboard)
 * Falls back to constants for safety.
 */
async function getAllowedProviderTypesFromPricingConfig() {
  let pricing = await PricingConfig.findOne();
  if (!pricing) pricing = await PricingConfig.create({});

  const allowedTowTruckTypes =
    Array.isArray(pricing.towTruckTypes) && pricing.towTruckTypes.length > 0
      ? pricing.towTruckTypes
      : TOW_TRUCK_TYPES;

  const allowedMechanicCategories =
    Array.isArray(pricing.mechanicCategories) && pricing.mechanicCategories.length > 0
      ? pricing.mechanicCategories
      : MECHANIC_CATEGORIES;

  const allowedVehicleTypes =
    Array.isArray(pricing.vehicleTypes) && pricing.vehicleTypes.length > 0
      ? pricing.vehicleTypes
      : VEHICLE_TYPES;

  return {
    pricing,
    allowedTowTruckTypes,
    allowedMechanicCategories,
    allowedVehicleTypes,
  };
}

/**
 * ✅ Provider heartbeat
 * POST /api/providers/heartbeat
 */
router.post("/heartbeat", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.providerProfile) {
      return res.status(403).json({ message: "Only providers can send heartbeats" });
    }

    user.providerProfile.lastHeartbeatAt = new Date();
    user.providerProfile.lastSeenAt = new Date();

    // If heartbeat received but flagged offline, we keep it offline
    // unless they explicitly toggle online.
    // However, if they are online, this confirms they ARE still there.

    await user.save();
    return res.status(200).json({
      isOnline: user.providerProfile.isOnline,
      lastHeartbeatAt: user.providerProfile.lastHeartbeatAt
    });
  } catch (err) {
    return res.status(500).json({ message: "Heartbeat failed", error: err.message });
  }
});

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
      "name firstName lastName email phone birthday nationalityType saIdNumber passportNumber country role providerProfile ratingStats createdAt updatedAt"
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
 * ✅ Provider profile update
 * PATCH /api/providers/me
 */
router.patch("/me", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can update this profile" });
    }

    const { email, phone, mechanicCategories, towTruckTypes, carTypesSupported, jobPreference } = req.body || {};

    const { allowedTowTruckTypes, allowedMechanicCategories, allowedVehicleTypes } =
      await getAllowedProviderTypesFromPricingConfig();

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.providerProfile) user.providerProfile = {};

    // email/phone update (existing behavior)
    if (typeof email === "string" && email.trim()) user.email = email.trim();
    if (typeof phone === "string" && phone.trim()) user.phone = phone.trim();

    // car types (both roles)
    if (Array.isArray(carTypesSupported) && carTypesSupported.length > 0) {
      const normalizedCars = normalizeStringArray(carTypesSupported);
      const invalidCars = normalizedCars.filter((v) => !allowedVehicleTypes.includes(v));
      if (invalidCars.length > 0) {
        return res.status(400).json({
          message: `Invalid carTypesSupported: ${invalidCars.join(", ")}`,
          allowed: allowedVehicleTypes,
        });
      }
      user.providerProfile.carTypesSupported = normalizedCars;
    }

    // mechanic categories (mechanic only)
    if (req.user.role === USER_ROLES.MECHANIC) {
      if (Array.isArray(mechanicCategories) && mechanicCategories.length > 0) {
        const normalizedCats = normalizeStringArray(mechanicCategories);
        const invalid = normalizedCats.filter((c) => !allowedMechanicCategories.includes(c));
        if (invalid.length > 0) {
          return res.status(400).json({
            message: `Invalid mechanicCategories: ${invalid.join(", ")}`,
            allowed: allowedMechanicCategories,
          });
        }
        user.providerProfile.mechanicCategories = normalizedCats;
      }
    }

    // tow truck types (tow truck only)
    if (req.user.role === USER_ROLES.TOW_TRUCK) {
      if (Array.isArray(towTruckTypes) && towTruckTypes.length > 0) {
        const normalizedTypes = normalizeStringArray(towTruckTypes);
        const invalid = normalizedTypes.filter((t) => !allowedTowTruckTypes.includes(t));
        if (invalid.length > 0) {
          return res.status(400).json({
            message: `Invalid towTruckTypes: ${invalid.join(", ")}`,
            allowed: allowedTowTruckTypes,
          });
        }
        user.providerProfile.towTruckTypes = normalizedTypes;
      }
    }

    if (jobPreference && ["BOTH", "INSURANCE", "CASH"].includes(jobPreference.toUpperCase())) {
      user.providerProfile.jobPreference = jobPreference.toUpperCase();
    }

    await user.save();

    const fresh = await User.findById(user._id).select(
      "name email phone role providerProfile ratingStats createdAt updatedAt"
    );

    return res.status(200).json({ user: fresh });
  } catch (err) {
    return res.status(500).json({
      message: "Could not update provider profile",
      error: err.message,
    });
  }
});

/**
 * ✅ Provider updates online/offline + current location
 * PATCH /api/providers/me/status
 */
router.patch("/me/status", auth, async (req, res) => {
  try {
    const {
      isOnline,
      lat,
      lng,
      towTruckTypes,
      carTypesSupported,
      mechanicCategories, // ✅ NEW
      jobPreference, // ✅ NEW
    } = req.body;

    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only service providers can update status" });
    }

    const { allowedTowTruckTypes, allowedMechanicCategories, allowedVehicleTypes } =
      await getAllowedProviderTypesFromPricingConfig();

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

      // Phase 7: Document Expiry Restriction
      const docs = user.providerProfile.verificationDocs || {};
      const now = new Date();
      let hasOverdueDoc = false;
      let overdueLabel = "";

      for (const field of Object.keys(docs)) {
        const d = docs[field];
        if (d && d.status === "EXPIRED" && d.gracePeriodEnd && new Date(d.gracePeriodEnd) <= now) {
          hasOverdueDoc = true;
          overdueLabel = field.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
          break;
        }
        if (d && d.status === "UPDATE_REQUIRED") {
            // Optional: block if update is overdue? For now just allow if not expired.
        }
      }

      if (hasOverdueDoc) {
        return res.status(403).json({
          message: `Account restricted. Required document [${overdueLabel}] expired and grace period ended.`,
          code: "DOCUMENTS_EXPIRED"
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

      // ✅ IMPORTANT: Mechanics should not go online without categories saved
      if (req.user.role === USER_ROLES.MECHANIC) {
        const existingCats = user.providerProfile.mechanicCategories || [];
        const incomingCats =
          Array.isArray(mechanicCategories) && mechanicCategories.length > 0
            ? normalizeStringArray(mechanicCategories)
            : [];

        const finalCats = incomingCats.length > 0 ? incomingCats : existingCats;

        if (!finalCats || finalCats.length === 0) {
          return res.status(400).json({
            message: "Cannot go ONLINE: mechanicCategories missing. Please select categories.",
            code: "MECHANIC_CATEGORIES_MISSING",
          });
        }

        const invalid = finalCats.filter((c) => !allowedMechanicCategories.includes(c));
        if (invalid.length > 0) {
          return res.status(400).json({
            message: `Invalid mechanicCategories: ${invalid.join(", ")}`,
            allowed: allowedMechanicCategories,
          });
        }

        user.providerProfile.mechanicCategories = finalCats;
      }
    }

    if (hasIncomingLatLng) {
      user.providerProfile.location = {
        type: "Point",
        coordinates: [incomingLng, incomingLat],
      };
    }

    user.providerProfile.lastSeenAt = new Date();

    // ✅ Save supported car types for both roles (only if non-empty to avoid wiping)
    if (Array.isArray(carTypesSupported) && carTypesSupported.length > 0) {
      const normalizedCars = normalizeStringArray(carTypesSupported);
      const invalidCars = normalizedCars.filter((v) => !allowedVehicleTypes.includes(v));
      if (invalidCars.length > 0) {
        return res.status(400).json({
          message: `Invalid carTypesSupported: ${invalidCars.join(", ")}`,
          allowed: allowedVehicleTypes,
        });
      }
      user.providerProfile.carTypesSupported = normalizedCars;
    }

    // ✅ TowTruck role: only allow towTruckTypes (only if non-empty to avoid wiping)
    if (req.user.role === USER_ROLES.TOW_TRUCK) {
      if (Array.isArray(towTruckTypes) && towTruckTypes.length > 0) {
        const normalizedTypes = normalizeStringArray(towTruckTypes);
        const invalid = normalizedTypes.filter((t) => !allowedTowTruckTypes.includes(t));
        if (invalid.length > 0) {
          return res.status(400).json({
            message: `Invalid towTruckTypes: ${invalid.join(", ")}`,
            allowed: allowedTowTruckTypes,
          });
        }
        user.providerProfile.towTruckTypes = normalizedTypes;
      }
    }

    // ✅ Mechanic role: allow mechanicCategories update (only if non-empty to avoid wiping)
    if (req.user.role === USER_ROLES.MECHANIC) {
      if (Array.isArray(mechanicCategories) && mechanicCategories.length > 0) {
        const normalizedCats = normalizeStringArray(mechanicCategories);
        const invalid = normalizedCats.filter((c) => !allowedMechanicCategories.includes(c));
        if (invalid.length > 0) {
          return res.status(400).json({
            message: `Invalid mechanicCategories: ${invalid.join(", ")}`,
            allowed: allowedMechanicCategories,
          });
        }
        user.providerProfile.mechanicCategories = normalizedCats;
      }
    }

    if (jobPreference && ["BOTH", "INSURANCE", "CASH"].includes(jobPreference.toUpperCase())) {
      user.providerProfile.jobPreference = jobPreference.toUpperCase();
    }

    if (typeof isOnline === "boolean") {
      // ✅ NEW: Restriction - Provider cannot go OFFLINE while an active job exists
      if (isOnline === false) {
        const activeJobCount = await Job.countDocuments({
          assignedTo: user._id,
          status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] },
        });

        if (activeJobCount > 0) {
          return res.status(400).json({
            message: "Cannot go OFFLINE while you have an active job 📵",
            activeJobCount,
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
 */
router.patch("/jobs/:jobId/accept", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can accept jobs" });
    }

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
      [
        {
          $set: {
            assignedTo: req.user._id,
            status: JOB_STATUSES.ASSIGNED,
            lockedAt: { $ifNull: ["$lockedAt", new Date()] },
          },
        },
      ],
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

    if (job.status === JOB_STATUSES.IN_PROGRESS) {
      return res.status(403).json({
        code: "PROVIDER_CANNOT_CANCEL_IN_PROGRESS",
        message: "You cannot cancel a job that has already started.",
      });
    }

    if (job.status !== JOB_STATUSES.ASSIGNED) {
      return res.status(400).json({
        code: "PROVIDER_CANCEL_NOT_ALLOWED",
        message: "You can only cancel immediately after accepting the job (ASSIGNED).",
        status: job.status,
      });
    }

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

    // ✅ NEW (SAFE): rebroadcast should prefer providers in same country if job.countryCode exists
    const jobCountry = String(job.countryCode || "").trim().toUpperCase();

    const providerQuery = {
      role: job.roleNeeded,
      "providerProfile.isOnline": true,
      _id: { $nin: job.excludedProviders },
    };

    if (jobCountry) {
      providerQuery.$or = [
        { countryCode: jobCountry },
        { "providerProfile.allowedCountries": jobCountry },
      ];
    }

    const newProviders = await User.find(providerQuery).limit(10);

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

/**
 * ✅ VALIDATE COMPANY CODE (for Company Drivers)
 * POST /api/providers/validate-company-code
 */
router.post("/validate-company-code", auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: "Company code is required" });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Race condition protection: Atomic update ensures code is only used once
    const verificationCode = await DriverVerificationCode.findOneAndUpdate(
      {
        code: code.trim().toUpperCase(),
        isRevoked: false,
        usedBy: null, // ensure unused
        expiresAt: { $gt: new Date() } // ensure not expired
      },
      {
        $set: {
          usedBy: user._id,
          usedAt: new Date()
        }
      },
      { new: true }
    ).populate("partnerId");

    if (!verificationCode) {
      return res.status(404).json({ message: "Invalid, expired, or already used verification code." });
    }

    // Link provider to partner via Verification System (Phase 11 Restructure)
    user.partnerId = verificationCode.partnerId._id;
    user.partnerRole = "DRIVER";

    if (!user.providerProfile) user.providerProfile = {};
    if (!user.providerProfile.verificationDocs) user.providerProfile.verificationDocs = {};

    user.providerProfile.verificationDocs.companyVerification = {
      isCompanyDriver: true,
      partnerId: verificationCode.partnerId._id,
      status: "VERIFIED", // Code itself is verified, NOT the provider
      verifiedAt: new Date(),
      partnerName: verificationCode.partnerId.name,
      partnerType: verificationCode.partnerId.type,
      partnerCode: verificationCode.code, // Store the actual verified code
      verificationSource: "COMPANY"
    };

    // ✅ CRITICAL FIX: Ensure provider stays PENDING until manual admin approval
    if (user.providerProfile.verificationStatus !== "APPROVED") {
        user.providerProfile.verificationStatus = "PENDING";
    }

    user.markModified("providerProfile.verificationDocs.companyVerification");
    await user.save();

    await logAuditEvent(req, {
      action: "PARTNER_CODE_USED",
      entityType: "PARTNER",
      entityId: verificationCode.partnerId._id,
      details: { driverId: user._id, code: verificationCode.code }
    });

    return res.status(200).json({
      message: "Company verified successfully ✅",
      partner: {
        name: verificationCode.partnerId.name,
        type: verificationCode.partnerId.type,
        verifiedAt: verificationCode.usedAt
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Validation failed", error: err.message });
  }
});

export default router;