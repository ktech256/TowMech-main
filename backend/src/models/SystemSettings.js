import mongoose from "mongoose";

const SystemSettingsSchema = new mongoose.Schema(
  {
    // ✅ GENERAL
    platformName: { type: String, default: "TowMech" },
    supportEmail: { type: String, default: "" },
    supportPhone: { type: String, default: "" },

    // ✅ PEAK SETTINGS
    nightFeeEnabled: { type: Boolean, default: false },
    nightFeePercentage: { type: Number, default: 0 },

    weekendFeeEnabled: { type: Boolean, default: false },
    weekendFeePercentage: { type: Number, default: 0 },

    // ✅ INTEGRATIONS (ALL KEYS LIVE HERE ✅)
    integrations: {
      paymentGateway: {
        type: String,
        default: "IKHOKHA",
        enum: ["IKHOKHA", "PEACH_PAYMENTS", "PAYFAST"],
      },

      // ✅ General payment keys (optional / fallback)
      paymentPublicKey: { type: String, default: "" },
      paymentSecretKey: { type: String, default: "" },
      paymentWebhookSecret: { type: String, default: "" },

      // ✅ Google Maps API Key (Android fetch safe)
      googleMapsKey: { type: String, default: "" },

      // ✅ SMS
      smsProvider: { type: String, default: "" },
      smsApiKey: { type: String, default: "" },

      /**
       * ✅ ✅ ✅ iKhokha Keys
       * ✅ entityId is OPTIONAL (can be empty)
       */
      ikhEntityId: { type: String, default: "", required: false }, // ✅ optional
      ikhApiKey: { type: String, default: "" },
      ikhSecretKey: { type: String, default: "" },

      /**
       * ✅ ✅ ✅ Peach Payments Keys
       */
      peachEntityId: { type: String, default: "" },
      peachAccessToken: { type: String, default: "" },

      /**
       * ✅ ✅ ✅ PayFast Keys
       */
      payfastMerchantId: { type: String, default: "" },
      payfastMerchantKey: { type: String, default: "" },
      payfastPassphrase: { type: String, default: "" },

      /**
       * ✅ ✅ ✅ ENV MODE SETTINGS (so no coding later)
       */
      payfastMode: { type: String, default: "SANDBOX", enum: ["SANDBOX", "LIVE"] },
      peachMode: { type: String, default: "SANDBOX", enum: ["SANDBOX", "LIVE"] },
      ikhokhaMode: { type: String, default: "SANDBOX", enum: ["SANDBOX", "LIVE"] },
    },

    // ✅ AUDIT
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("SystemSettings", SystemSettingsSchema);