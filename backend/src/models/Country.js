// src/models/Country.js
import mongoose from "mongoose";

/**
 * Country
 * Master table for all supported countries globally.
 * Controls: currency, languages, timezone, phone rules, and availability.
 */

const phoneRulesSchema = new mongoose.Schema(
  {
    // Example: "ZA"
    countryCallingCode: { type: String, default: null }, // e.g. "27"
    // Regex for local format (example ZA: ^0\d{9}$)
    localRegex: { type: String, default: null },
    localExample: { type: String, default: null }, // e.g. "0711111111"
    // Regex for E.164 (generic: ^\+\d{6,15}$)
    e164Regex: { type: String, default: "^\\+\\d{6,15}$" },
  },
  { _id: false }
);

const countrySchema = new mongoose.Schema(
  {
    // ISO-3166-1 alpha-2 code (ZA, KE, UG, US, GB...)
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    name: { type: String, required: true, trim: true }, // "South Africa"
    flagEmoji: { type: String, default: null }, // "🇿🇦" optional

    // Currency ISO code: ZAR, KES, UGX, USD...
    currencyCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    // Currency symbol for UI only: "R", "KSh", "$"
    currencySymbol: { type: String, default: null },

    // Default timezone (important for invoices, disputes, etc)
    timezone: { type: String, default: "UTC" }, // e.g. "Africa/Johannesburg"

    // Languages supported in this country
    languages: {
      type: [String],
      default: ["en"],
    },

    defaultLanguage: { type: String, default: "en" },

    // Phone formatting rules (validation + E.164 conversion)
    phoneRules: { type: phoneRulesSchema, default: () => ({}) },

    // If disabled, app should block selection / hide country
    isActive: { type: Boolean, default: true },

    // Soft launch toggle (country visible only to admins/testers)
    isPublic: { type: Boolean, default: true },

    // For future: geo/region routing (data center routing)
    region: {
      type: String,
      default: "GLOBAL",
      enum: ["GLOBAL", "AFRICA", "EUROPE", "ASIA", "AMERICAS", "OCEANIA"],
    },

    // Optional: VAT/tax rules (future-ready)
    tax: {
      vatPercent: { type: Number, default: 0 }, // e.g. 15 for ZA
      vatName: { type: String, default: "VAT" },
      pricesIncludeVat: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

countrySchema.index({ code: 1 });
countrySchema.index({ isActive: 1, isPublic: 1 });

export default mongoose.model("Country", countrySchema);