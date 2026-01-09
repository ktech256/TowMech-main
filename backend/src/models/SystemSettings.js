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
        default: "YOCO",
        enum: [
          "YOCO",
          "PAYFAST",
          "PAYGATE",
          "PEACH_PAYMENTS",
          "PAYU",
          "IKHOKHA",
          "DPO_GROUP",
          "OZOW",
          "SNAPSCAN",
          "ZAPPER",
          "PAYFLEX",
        ],
      },

      paymentPublicKey: { type: String, default: "" },
      paymentSecretKey: { type: String, default: "" },
      paymentWebhookSecret: { type: String, default: "" },

      googleMapsKey: { type: String, default: "" },

      smsProvider: { type: String, default: "" },
      smsApiKey: { type: String, default: "" },
    },

    // ✅ AUDIT
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("SystemSettings", SystemSettingsSchema);