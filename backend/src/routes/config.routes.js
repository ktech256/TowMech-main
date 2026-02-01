// src/routes/config.routes.js
import express from "express";
import Country from "../models/Country.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";
import CountryUiConfig from "../models/CountryUiConfig.js";
import PricingConfig from "../models/PricingConfig.js";

const router = express.Router();

/**
 * ✅ PUBLIC: Get app config for a given country
 * GET /api/config/all
 *
 * Country resolution priority:
 * 1) Header: X-COUNTRY-CODE
 * 2) Query:  ?country=ZA
 * 3) Fallback: process.env.DEFAULT_COUNTRY_CODE || "ZA"
 */
router.get("/all", async (req, res) => {
  try {
    const headerCountry = req.headers["x-country-code"];
    const queryCountry = req.query.country;

    const countryCode = String(
      headerCountry || queryCountry || process.env.DEFAULT_COUNTRY_CODE || "ZA"
    )
      .trim()
      .toUpperCase();

    // ✅ Load Country (optional but recommended)
    const country = await Country.findOne({ code: countryCode }).lean();

    // ✅ Load per-country service flags + KYC + payment routing
    const serviceConfig = await CountryServiceConfig.findOne({
      countryCode,
    }).lean();

    // ✅ Load per-country UI config
    const uiConfig = await CountryUiConfig.findOne({
      countryCode,
    }).lean();

    // ✅ Existing pricing config (global for now)
    // Later you can change this to per-country pricing (CountryPricingConfig)
    let pricing = await PricingConfig.findOne().lean();
    if (!pricing) {
      pricing = await PricingConfig.create({});
      pricing = pricing.toObject();
    }

    // ✅ If country not found, still return safe defaults
    const resolvedCountry = country || {
      code: countryCode,
      name: countryCode,
      currency: "ZAR",
      languages: ["en"],
      phone: { mode: "E164_OR_LOCAL", example: "0711111111" },
      enabled: true,
    };

    const resolvedServiceConfig =
      serviceConfig || {
        countryCode,
        enabled: true,
        services: {
          towingEnabled: true,
          mechanicEnabled: true,
          roadsideAssistanceEnabled: false,
          batteryJumpstartEnabled: false,
          tyreChangeEnabled: false,
          fuelDeliveryEnabled: false,
          carWashEnabled: false,
          insuranceModeEnabled: false,
        },
        kyc: {
          idDocumentRequired: true,
          selfieRequired: false,
          proofOfAddressRequired: false,
          towTruckLicenseRequired: true,
          vehicleProofRequired: true,
          workshopProofRequired: false,
          extraDocs: [],
        },
        payments: {
          paystackEnabled: false,
          ikhokhaEnabled: false,
          payfastEnabled: false,
          mpesaEnabled: false,
          flutterwaveEnabled: false,
          stripeEnabled: false,
          bookingFeeRequired: true,
          bookingFeePercent: 0,
          bookingFeeFlat: 0,
        },
        support: {
          supportEmail: null,
          supportWhatsApp: null,
          supportPhone: null,
          queueKey: null,
        },
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

    return res.status(200).json({
      country: resolvedCountry,
      services: resolvedServiceConfig,
      ui: resolvedUiConfig,
      pricing, // existing global pricing model
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