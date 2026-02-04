// backend/src/routes/config.routes.js
import express from "express";
import Country from "../models/Country.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";
import CountryUiConfig from "../models/CountryUiConfig.js";
import PricingConfig from "../models/PricingConfig.js";

const router = express.Router();

function resolveCountryCode(req) {
  const headerCountry = req.headers["x-country-code"];
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
 * ✅ PUBLIC: Get app config for a given country
 * GET /api/config/all
 */
router.get("/all", async (req, res) => {
  try {
    const countryCode = resolveCountryCode(req);

    // ✅ Load Country (recommended)
    const country = await Country.findOne({ code: countryCode }).lean();

    // ✅ Load per-country service flags + payment routing
    let serviceConfig = await CountryServiceConfig.findOne({ countryCode }).lean();
    if (!serviceConfig) {
      // create defaults so dashboard/app are consistent
      const created = await CountryServiceConfig.create({ countryCode, services: {}, payments: {} });
      serviceConfig = created.toObject();
    }

    // ✅ Load per-country UI config
    const uiConfig = await CountryUiConfig.findOne({ countryCode }).lean();

    // ✅ Pricing config (parallel per country OR fallback to global record)
    let pricing =
      (await PricingConfig.findOne({ countryCode }).lean()) ||
      (await PricingConfig.findOne().lean());

    if (!pricing) {
      const created = await PricingConfig.create({ countryCode });
      pricing = created.toObject();
    }

    // ✅ If country not found, still return safe defaults
    const resolvedCountry = country || {
      code: countryCode,
      name: countryCode,
      currency: "ZAR",
      supportedLanguages: ["en"],
      isActive: true,
    };

    // ✅ Ensure serviceConfig.services contains the dashboard keys
    const normalizedServices = normalizeServiceDefaults(serviceConfig?.services);

    const resolvedServiceConfig = {
      ...(serviceConfig || {}),
      countryCode,
      services: normalizedServices,
      payments: serviceConfig?.payments || {},
    };

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

    // ✅ IMPORTANT: currency should come from Country (dashboard Countries table)
    // Android currently reads config.pricing.currency in places, so we inject it here.
    pricing = { ...(pricing || {}) };
    pricing.currency = resolvedCountry.currency || pricing.currency || "ZAR";

    return res.status(200).json({
      country: resolvedCountry,
      services: resolvedServiceConfig,
      ui: resolvedUiConfig,
      pricing,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ CONFIG /all ERROR:", err);
    return res.status(500).json({
      message: "Could not load config",
      error: err?.message || String(err),
    });
  }
});

export default router;