// backend/src/models/CountryServiceConfig.js
import mongoose from "mongoose";

const CountryServiceConfigSchema = new mongoose.Schema(
  {
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    /**
     * ✅ Country service flags (Dashboard controls these)
     * We standardize on *Enabled keys, but accept legacy/simple keys via routes.
     */
    services: {
      // ✅ Dashboard “core” toggles
      towingEnabled: { type: Boolean, default: true },
      mechanicEnabled: { type: Boolean, default: true },
      emergencySupportEnabled: { type: Boolean, default: true },
      insuranceEnabled: { type: Boolean, default: false },
      chatEnabled: { type: Boolean, default: true },
      ratingsEnabled: { type: Boolean, default: true },

      // ✅ Extended services (future proof)
      winchRecoveryEnabled: { type: Boolean, default: false },
      roadsideAssistanceEnabled: { type: Boolean, default: false },
      jumpStartEnabled: { type: Boolean, default: false },
      tyreChangeEnabled: { type: Boolean, default: false },
      fuelDeliveryEnabled: { type: Boolean, default: false },
      lockoutEnabled: { type: Boolean, default: false },

      // ✅ alias flags (kept for backward-compat reads in old code)
      supportEnabled: { type: Boolean, default: true },
    },

    payments: {
      // legacy flags used by paymentRouter.js
      paystackEnabled: { type: Boolean, default: false },
      ikhokhaEnabled: { type: Boolean, default: false },
      payfastEnabled: { type: Boolean, default: false },
      mpesaEnabled: { type: Boolean, default: false },
      flutterwaveEnabled: { type: Boolean, default: false },
      stripeEnabled: { type: Boolean, default: false },

      bookingFeeRequired: { type: Boolean, default: true },
      bookingFeePercent: { type: Number, default: 0 },
      bookingFeeFlat: { type: Number, default: 0 },

      // ✅ NEW (dashboard payment-routing)
      defaultProvider: { type: String, default: "paystack" },

      // store provider keys/settings without schema fights
      providers: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  { timestamps: true }
);

// ✅ Normalize (safe)
CountryServiceConfigSchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();

  // ✅ keep supportEnabled aligned with emergencySupportEnabled for legacy reads
  if (this.services) {
    if (typeof this.services.emergencySupportEnabled === "boolean") {
      this.services.supportEnabled = this.services.emergencySupportEnabled;
    }
  }

  next();
});

export default mongoose.models.CountryServiceConfig ||
  mongoose.model("CountryServiceConfig", CountryServiceConfigSchema);