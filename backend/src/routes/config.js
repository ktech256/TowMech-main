import express from "express";
import PricingConfig from "../models/PricingConfig.js"; // ✅ use your existing config file
import User from "../models/User.js"; // ✅ for VEHICLE_TYPES + TOW_TRUCK_TYPES

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
      towTruckTypes: User.TOW_TRUCK_TYPES || []
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load types",
      error: err.message
    });
  }
});

/**
 * ✅ GET PRICING CONFIG
 * Frontend uses this to show pricing breakdown + preview estimates
 * GET /api/config/pricing
 */
router.get("/pricing", async (req, res) => {
  try {
    return res.json({
      success: true,
      pricing: PricingConfig
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load pricing config",
      error: err.message
    });
  }
});

/**
 * ✅ OPTIONAL: GET EVERYTHING AT ONCE
 * GET /api/config/all
 */
router.get("/all", async (req, res) => {
  try {
    return res.json({
      success: true,
      vehicleTypes: User.VEHICLE_TYPES || [],
      towTruckTypes: User.TOW_TRUCK_TYPES || [],
      pricing: PricingConfig
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load config",
      error: err.message
    });
  }
});

export default router;