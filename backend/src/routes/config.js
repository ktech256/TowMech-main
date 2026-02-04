// backend/src/routes/config.js
import express from "express";
import PricingConfig from "../models/PricingConfig.js";
import ServiceCategory from "../models/ServiceCategory.js";
import SystemSettings from "../models/SystemSettings.js";
import Country from "../models/Country.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";
import CountryUiConfig from "../models/CountryUiConfig.js";
import {
  VEHICLE_TYPES,
  TOW_TRUCK_TYPES,
  MECHANIC_CATEGORIES,
} from "../models/User.js";

const router = express.Router();

/**
 * ✅ Helper: ensure PricingConfig always exists (global fallback)
 */
async function getOrCreatePricingConfig(countryCode) {
  // Prefer per-country record, fallback to any/global
  let pricing =
    (countryCode
      ? await PricingConfig.findOne({ countryCode }).lean()
      : null) || (await PricingConfig.findOne().lean());

  if (!pricing) {
    const created = await PricingConfig.create(countryCode ? { countryCode } : {});
    pricing = created.toObject();
  }

  return pricing;
}

function resolveCountryCode(req) {
  const headerCountry = req.headers["x-country-code"] || req.headers["X-COUNTRY-CODE"];
  const queryCountry = req.query.country;

  return String(headerCountry || queryCountry || process.env.DEFAULT_COUNTRY_CODE || "ZA")
    .trim()
    .toUpperCase();
}

function normalizeServiceDefaults(services = {}) {
  const s = services || {};
  const emergency =
    typeof s.emergencySupportEnabled === "boolean"
      ? s.emergencySupportEnabled
      : typeof s.supportEnabled === "boolean"
      ? s.supportEnabled
      : true;

  return {
    towingEnabled: typeof s.towingEnabled === "boolean" ? s.towingEnabled : true,
    mechanicEnabled: typeof s.mechanicEnabled === "boolean" ? s.mechanicEnabled : true,

    emergencySupportEnabled: emergency,
    supportEnabled: emergency,

    insuranceEnabled: typeof s.insuranceEnabled === "boolean" ? s.insuranceEnabled : false,
    chatEnabled: typeof s.chatEnabled === "boolean" ? s.chatEnabled : true,
    ratingsEnabled: typeof s.ratingsEnabled === "boolean" ? s.ratingsEnabled : true,

    winchRecoveryEnabled: typeof s.winchRecoveryEnabled === "boolean" ? s.winchRecoveryEnabled : false,
    roadsideAssistanceEnabled:
      typeof s.roadsideAssistanceEnabled === "boolean" ? s.roadsideAssistanceEnabled : false,
    jumpStartEnabled: typeof s.jumpStartEnabled === "boolean" ? s.jumpStartEnabled : false,
    tyreChangeEnabled: typeof s.tyreChangeEnabled === "boolean" ? s.tyreChangeEnabled : false,
    fuelDeliveryEnabled: typeof s.fuelDeliveryEnabled === "boolean" ? s.fuelDeliveryEnabled : false,
    lockoutEnabled: typeof s.lockoutEnabled === "boolean" ? s.lockoutEnabled : false,
  };
}

/**
 * ✅ GET TYPES
 * GET /api/config/types
 *
 * - Tow truck types + mechanic categories prefer PricingConfig
 * - Vehicle types come from constants
 */
router.get("/types", async (req, res) => {
  try {
    const countryCode = resolveCountryCode(req);
    const pricing = await getOrCreatePricingConfig(countryCode);

    return res.json({
      success: true,
      vehicleTypes: VEHICLE_TYPES || [],
      towTruckTypes:
        pricing?.towTruckTypes?.length > 0 ? pricing.towTruckTypes : TOW_TRUCK_TYPES || [],
      mechanicCategories:
        pricing?.mechanicCategories?.length > 0 ? pricing.mechanicCategories : MECHANIC_CATEGORIES || [],
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
    const countryCode = resolveCountryCode(req);
    const pricing = await getOrCreatePricingConfig(countryCode);
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
    const categories = await ServiceCategory.find({ active: true }).sort({ createdAt: -1 });

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
 * ✅ FIX:
 * - Adds: country + services + ui + serverTime (so Android can disable buttons)
 * - Keeps: success + vehicleTypes + towTruckTypes + mechanicCategories + pricing + categories (legacy)
 */
router.get("/all", async (req, res) => {
  try {
    const countryCode = resolveCountryCode(req);

    // Country
    const country =
      (await Country.findOne({ code: countryCode }).lean()) || {
        code: countryCode,
        name: countryCode,
        currency: "ZAR",
        supportedLanguages: ["en"],
        isActive: true,
      };

    // Services (dashboard source)
    let serviceConfig = await CountryServiceConfig.findOne({ countryCode }).lean();
    if (!serviceConfig) {
      const created = await CountryServiceConfig.create({ countryCode, services: {}, payments: {} });
      serviceConfig = created.toObject();
    }
    const normalizedServices = normalizeServiceDefaults(serviceConfig?.services);

    const resolvedServiceConfig = {
      ...(serviceConfig || {}),
      countryCode,
      services: normalizedServices,
      payments: serviceConfig?.payments || {},
    };

    // UI
    const uiConfig = await CountryUiConfig.findOne({ countryCode }).lean();
    const resolvedUiConfig =
      uiConfig || {
        countryCode,
        appName: "TowMech",
        primaryColor: "#0033A0",
        accentColor: "#00C853",
        mapBackgroundKey: "default",
        heroImageKey: "default",
        enabled: true,
      };

    // Pricing + legacy types
    const pricing = await getOrCreatePricingConfig(countryCode);

    // Ensure currency injected (Android reads pricing.currency)
    const pricingOut = { ...(pricing || {}) };
    pricingOut.currency = country.currency || pricingOut.currency || "ZAR";

    const categories = await ServiceCategory.find({ active: true });

    return res.json({
      // ✅ New shape (Android dashboard-first models)
      country,
      services: resolvedServiceConfig,
      ui: resolvedUiConfig,
      pricing: pricingOut,
      serverTime: new Date().toISOString(),

      // ✅ Legacy fields (older app/dashboard code)
      success: true,
      vehicleTypes: VEHICLE_TYPES || [],
      towTruckTypes:
        pricingOut?.towTruckTypes?.length > 0 ? pricingOut.towTruckTypes : TOW_TRUCK_TYPES || [],
      mechanicCategories:
        pricingOut?.mechanicCategories?.length > 0 ? pricingOut.mechanicCategories : MECHANIC_CATEGORIES || [],
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