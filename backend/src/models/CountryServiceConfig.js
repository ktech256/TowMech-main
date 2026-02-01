// backend/src/models/CountryServiceConfig.js
import mongoose from "mongoose";

const CountryServiceConfigSchema = new mongoose.Schema(
  {
    countryCode: { type: String, required: true, uppercase: true, trim: true, unique: true },

    services: {
      towingEnabled: { type: Boolean, default: true },
      mechanicEnabled: { type: Boolean, default: true },
      winchRecoveryEnabled: { type: Boolean, default: false },
      roadsideAssistanceEnabled: { type: Boolean, default: false },
      jumpStartEnabled: { type: Boolean, default: false },
      tyreChangeEnabled: { type: Boolean, default: false },
      fuelDeliveryEnabled: { type: Boolean, default: false },
      lockoutEnabled: { type: Boolean, default: false },
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

export default mongoose.models.CountryServiceConfig ||
  mongoose.model("CountryServiceConfig", CountryServiceConfigSchema);