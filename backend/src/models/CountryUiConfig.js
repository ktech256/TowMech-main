// src/models/CountryUiConfig.js
import mongoose from "mongoose";

/**
 * CountryUiConfig
 * Controls UI branding per country (logo, splash, background, theme colors, etc).
 * Android + Website + Dashboard can fetch this via config endpoint.
 */

const themeSchema = new mongoose.Schema(
  {
    primaryColor: { type: String, default: "#0033A0" }, // TowMech blue
    secondaryColor: { type: String, default: "#FFFFFF" },
    accentColor: { type: String, default: "#FFC107" }, // optional
  },
  { _id: false }
);

const assetsSchema = new mongoose.Schema(
  {
    // These can be URLs (Cloudinary/S3/Firebase Storage/etc)
    logoUrl: { type: String, default: null },
    splashUrl: { type: String, default: null },
    onboardingBackgroundUrl: { type: String, default: null },

    // Example: map overlay background per country
    mapBackgroundUrl: { type: String, default: null },

    // Optional: playstore feature graphic per country
    featureGraphicUrl: { type: String, default: null },
  },
  { _id: false }
);

const textSchema = new mongoose.Schema(
  {
    appName: { type: String, default: "TowMech" },
    tagline: { type: String, default: "Roadside Assistance" },

    // Optional: per-country marketing text
    homeHeadline: { type: String, default: null },
    homeSubHeadline: { type: String, default: null },
  },
  { _id: false }
);

const countryUiConfigSchema = new mongoose.Schema(
  {
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
      unique: true,
    },

    // If disabled, fallback to global defaults in frontend
    isActive: { type: Boolean, default: true },

    theme: { type: themeSchema, default: () => ({}) },
    assets: { type: assetsSchema, default: () => ({}) },
    text: { type: textSchema, default: () => ({}) },

    // Optional: country-specific UI flags
    uiFlags: {
      showInsuranceOption: { type: Boolean, default: false },
      showEmergencyTab: { type: Boolean, default: true },
      showMechanicTab: { type: Boolean, default: true },
      showTowTruckTab: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

countryUiConfigSchema.index({ countryCode: 1 });

export default mongoose.model("CountryUiConfig", countryUiConfigSchema);