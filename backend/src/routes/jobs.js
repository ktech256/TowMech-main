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
 * ✅ Helper: Haversine Distance (km)
 */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;

  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/**
 * ✅ PREVIEW JOB
 * ✅ Returns pricing estimate without creating job
 * ✅ If towTruckTypeNeeded is missing -> returns results for ALL tow truck types
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

      // ✅ Get config to know towTruckTypes
      let config = await PricingConfig.findOne();
      if (!config) config = await PricingConfig.create({});

      const towTruckTypes = User.TOW_TRUCK_TYPES || [];

      // ✅ Compute real distance (only for tow truck)
      const distanceKm =
        roleNeeded === USER_ROLES.TOW_TRUCK && dropoffLat !== undefined && dropoffLng !== undefined
          ? haversineDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng)
          : 0;

      // ✅ If towTruckTypeNeeded exists -> normal preview
      if (towTruckTypeNeeded) {
        const pricing = await calculateJobPricing({
          roleNeeded,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          towTruckTypeNeeded,
          vehicleType,
          distanceKm // ✅ pass into calculateJobPricing
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
      }

      // ✅ Otherwise: return pricing for ALL tow truck types in one API call
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
          distanceKm
        });

        resultsByTowTruckType[type] = {
          estimatedTotal: pricing.estimatedTotal,
          bookingFee: pricing.bookingFee,
          currency: pricing.currency,
          estimatedDistanceKm: pricing.estimatedDistanceKm,
          towTruckTypeMultiplier: pricing.towTruckTypeMultiplier,
          vehicleTypeMultiplier: pricing.vehicleTypeMultiplier
        };
      }

      // ✅ Providers check (no towTruckTypeNeeded filter)
      const providers = await findNearbyProviders({
        roleNeeded,
        pickupLng,
        pickupLat,
        towTruckTypeNeeded: null,
        vehicleType,
        excludedProviders: [],
        maxDistanceMeters: 20000,
        limit: 10
      });

      if (!providers || providers.length === 0) {
        return res.status(200).json({
          providersFound: false,
          providerCount: 0,
          message: "No providers online within range.",
          preview: {
            currency: config.currency || "ZAR",
            distanceKm,
            resultsByTowTruckType
          }
        });
      }

      return res.status(200).json({
        providersFound: true,
        providerCount: providers.length,
        message: "Providers found ✅ Please select tow truck type",
        preview: {
          currency: config.currency || "ZAR",
          distanceKm,
          resultsByTowTruckType
        }
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

    // ✅ Distance (for real pricing)
    const distanceKm =
      roleNeeded === USER_ROLES.TOW_TRUCK && dropoffLat !== undefined && dropoffLng !== undefined
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
      distanceKm
    });

    const hasDropoff = dropoffLat !== undefined && dropoffLng !== undefined;

    const paymentMode =
      roleNeeded === USER_ROLES.TOW_TRUCK
        ? "DIRECT_TO_PROVIDER"
        : "PAY_AFTER_SERVICE";

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

export default router;