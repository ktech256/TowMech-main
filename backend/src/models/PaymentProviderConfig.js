// src/models/PaymentProviderConfig.js
import mongoose from "mongoose";

/**
 * PaymentProviderConfig
 * Controls which payment providers are enabled per country + stores provider keys/settings.
 *
 * Example:
 * - ZA: paystack enabled
 * - KE: mpesa enabled
 * - UG: flutterwave enabled
 *
 * NOTE:
 * - This model is designed for GLOBAL TowMech routing.
 * - Keys can be stored here OR via env vars.
 *   Best practice:
 *   - production keys in env
 *   - dashboard toggles here (enabled/disabled + display settings)
 */

const ProviderSettingsSchema = new mongoose.Schema(
  {
    // Generic toggle
    enabled: { type: Boolean, default: false },

    // Optional: display name in app/dashboard
    displayName: { type: String, default: "" },

    // Optional: environment mode
    mode: {
      type: String,
      enum: ["live", "sandbox"],
      default: "live",
    },

    // Optional provider credentials (only if you want to store in DB)
    // You can keep these blank and instead use env vars.
    publicKey: { type: String, default: "" },
    secretKey: { type: String, default: "" },

    // M-Pesa specifics
    shortcode: { type: String, default: "" },
    passkey: { type: String, default: "" },
    consumerKey: { type: String, default: "" },
    consumerSecret: { type: String, default: "" },

    // Flutterwave specifics
    encryptionKey: { type: String, default: "" },

    // Any extra provider config
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const PaymentProviderConfigSchema = new mongoose.Schema(
  {
    // Country scope
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    // Currency used in that country
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: "ZAR",
    },

    // Optional: default provider to use when user doesn't choose
    defaultProvider: {
      type: String,
      enum: ["paystack", "mpesa", "flutterwave", "manual", "none"],
      default: "none",
    },

    // Enable/disable payment routes for that country completely
    paymentsEnabled: {
      type: Boolean,
      default: true,
    },

    // Provider configs
    paystack: { type: ProviderSettingsSchema, default: () => ({}) },
    mpesa: { type: ProviderSettingsSchema, default: () => ({}) },
    flutterwave: { type: ProviderSettingsSchema, default: () => ({}) },

    // Manual / offline payment option (insurance partners etc.)
    manual: {
      enabled: { type: Boolean, default: false },
      displayName: { type: String, default: "Manual" },
      instructions: { type: String, default: "" },
    },

    // Optional: allow booking fee = 0 for insurance flows
    allowZeroBookingFee: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// One config per country
PaymentProviderConfigSchema.index({ countryCode: 1 }, { unique: true });

export default mongoose.model("PaymentProviderConfig", PaymentProviderConfigSchema);