import express from "express";
import PricingConfig from "../models/PricingConfig.js";
import User from "../models/User.js";

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

export default router;
