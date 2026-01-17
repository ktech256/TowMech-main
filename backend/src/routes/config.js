import express from "express";
import PricingConfig from "../models/PricingConfig.js";
import ServiceCategory from "../models/ServiceCategory.js";
import SystemSettings from "../models/SystemSettings.js";
import {
  VEHICLE_TYPES,
  TOW_TRUCK_TYPES,
  MECHANIC_CATEGORIES,
} from "../models/User.js";

const router = express.Router();

/**
 * ✅ Helper: ensure PricingConfig always exists
 */
async function getOrCreatePricingConfig() {
  let pricing = await PricingConfig.findOne();
  if (!pricing) pricing = await PricingConfig.create({});
  return pricing;
}

/**
 * ✅ GET TYPES
 * GET /api/config/types
 *
 * ✅ UPDATED:
 * - Tow truck types + mechanic categories now come from PricingConfig (dashboard source of truth)
 * - Vehicle types still come from User.js constants
 * - Keeps fallback to old constants so nothing breaks
 */
router.get("/types", async (req, res) => {
  try {
    const pricing = await getOrCreatePricingConfig();

    return res.json({
      success: true,

      vehicleTypes: VEHICLE_TYPES || [],

      // ✅ Prefer PricingConfig, fallback to old constants
      towTruckTypes:
        pricing?.towTruckTypes?.length > 0
          ? pricing.towTruckTypes
          : TOW_TRUCK_TYPES || [],

      mechanicCategories:
        pricing?.mechanicCategories?.length > 0
          ? pricing.mechanicCategories
          : MECHANIC_CATEGORIES || [],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load types",
      error: err.message,
    });
  }
});

/**
 * ✅ GET PRICING CONFIG
 * GET /api/config/pricing
 *
 * ✅ UPDATED:
 * - Ensures pricing config exists (so frontend always gets something)
 */
router.get("/pricing", async (req, res) => {
  try {
    const pricing = await getOrCreatePricingConfig();
    return res.json({ success: true, pricing });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load pricing config",
      error: err.message,
    });
  }
});

/**
 * ✅ SAFE ANDROID FETCH
 * GET /api/config/mobile
 */
router.get("/mobile", async (req, res) => {
  try {
    const settings = await SystemSettings.findOne();

    return res.json({
      success: true,

      platformName: settings?.platformName || "TowMech",
      supportEmail: settings?.supportEmail || "",
      supportPhone: settings?.supportPhone || "",

      googleMapsKey: settings?.integrations?.googleMapsKey || "",
      paymentGateway: settings?.integrations?.paymentGateway || "YOCO",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load mobile settings",
      error: err.message,
    });
  }
});

/**
 * ✅ PUBLIC SERVICE CATEGORIES
 * GET /api/config/service-categories
 */
router.get("/service-categories", async (req, res) => {
  try {
    const categories = await ServiceCategory.find({ active: true }).sort({
      createdAt: -1,
    });

    return res.json({
      success: true,
      categories,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load service categories",
      error: err.message,
    });
  }
});

/**
 * ✅ GET EVERYTHING AT ONCE
 * GET /api/config/all
 *
 * ✅ UPDATED:
 * - Includes PricingConfig types so Android can fetch everything in one call
 * - Still keeps fallbacks for older app versions
 */
router.get("/all", async (req, res) => {
  try {
    const pricing = await getOrCreatePricingConfig();
    const categories = await ServiceCategory.find({ active: true });

    return res.json({
      success: true,

      vehicleTypes: VEHICLE_TYPES || [],

      towTruckTypes:
        pricing?.towTruckTypes?.length > 0
          ? pricing.towTruckTypes
          : TOW_TRUCK_TYPES || [],

      mechanicCategories:
        pricing?.mechanicCategories?.length > 0
          ? pricing.mechanicCategories
          : MECHANIC_CATEGORIES || [],

      pricing: pricing || null,
      categories,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load config",
      error: err.message,
    });
  }
});

export default router;