import express from "express";
import PricingConfig from "../models/PricingConfig.js";
import User from "../models/User.js";
import SystemSettings from "../models/SystemSettings.js"; // ✅ NEW

const router = express.Router();

/**
 * ✅ GET VEHICLE TYPES + TOW TRUCK TYPES
 * Frontend uses this to populate dropdowns
 * GET /api/config/types
 */
router.get("/types", async (req, res) => {
  try {
    return res.json({
      success: true,
      vehicleTypes: User.VEHICLE_TYPES || [],
      towTruckTypes: User.TOW_TRUCK_TYPES || [],
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
 * ✅ GET PRICING CONFIG (FROM DATABASE ✅)
 * GET /api/config/pricing
 */
router.get("/pricing", async (req, res) => {
  try {
    const pricing = await PricingConfig.findOne();

    return res.json({
      success: true,
      pricing: pricing || null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load pricing config",
      error: err.message,
    });
  }
});

/**
 * ✅ GET EVERYTHING AT ONCE (FROM DATABASE ✅)
 * GET /api/config/all
 */
router.get("/all", async (req, res) => {
  try {
    const pricing = await PricingConfig.findOne();

    return res.json({
      success: true,
      vehicleTypes: User.VEHICLE_TYPES || [],
      towTruckTypes: User.TOW_TRUCK_TYPES || [],
      pricing: pricing || null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load config",
      error: err.message,
    });
  }
});

/**
 * ✅ ✅ ✅ ANDROID SAFE INTEGRATIONS FETCH
 * ✅ Mobile App should never hardcode keys
 *
 * GET /api/config/integrations
 *
 * Returns ONLY SAFE values:
 * ✅ paymentGateway
 * ✅ paymentPublicKey
 * ✅ googleMapsKey
 *
 * ❌ Never returns secret keys
 */
router.get("/integrations", async (req, res) => {
  try {
    const settings = await SystemSettings.findOne();

    // ✅ Default response if settings not yet created
    if (!settings) {
      return res.status(200).json({
        success: true,
        integrations: {
          paymentGateway: "YOCO",
          paymentPublicKey: "",
          googleMapsKey: "",
        },
      });
    }

    return res.status(200).json({
      success: true,
      integrations: {
        paymentGateway: settings.integrations?.paymentGateway || "YOCO",
        paymentPublicKey: settings.integrations?.paymentPublicKey || "",
        googleMapsKey: settings.integrations?.googleMapsKey || "",
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch integrations ❌",
      error: err.message,
    });
  }
});

export default router;