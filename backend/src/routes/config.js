import express from "express";
import PricingConfig from "../models/PricingConfig.js";
import User from "../models/User.js";
import ServiceCategory from "../models/ServiceCategory.js";
import SystemSettings from "../models/SystemSettings.js";

const router = express.Router();

/**
 * ✅ GET VEHICLE TYPES + TOW TRUCK TYPES
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
 * ✅ GET PRICING CONFIG
 * GET /api/config/pricing
 */
router.get("/pricing", async (req, res) => {
  try {
    const pricing = await PricingConfig.findOne();
    return res.json({ success: true, pricing: pricing || null });
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
 * ✅ Android app fetches keys/config without exposing secrets
 */
router.get("/mobile", async (req, res) => {
  try {
    const settings = await SystemSettings.findOne();

    return res.json({
      success: true,

      // ✅ Mobile safe values
      platformName: settings?.platformName || "TowMech",
      supportEmail: settings?.supportEmail || "",
      supportPhone: settings?.supportPhone || "",

      // ✅ Google Maps Key (allowed for app)
      googleMapsKey: settings?.integrations?.googleMapsKey || "",

      // ✅ Active payment gateway (app can know)
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
 */
router.get("/all", async (req, res) => {
  try {
    const pricing = await PricingConfig.findOne();
    const categories = await ServiceCategory.find({ active: true });

    return res.json({
      success: true,
      vehicleTypes: User.VEHICLE_TYPES || [],
      towTruckTypes: User.TOW_TRUCK_TYPES || [],
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