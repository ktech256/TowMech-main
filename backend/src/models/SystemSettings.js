import mongoose from "mongoose";

const SystemSettingsSchema = new mongoose.Schema(
  {
    // ✅ Feature Toggles
    enableTowTrucks: { type: Boolean, default: true },
    enableMechanics: { type: Boolean, default: true },

    // ✅ App Control
    forceUpdateVersion: { type: String, default: "" },

    // ✅ Policies
    terms: { type: String, default: "" },
    privacyPolicy: { type: String, default: "" },

    // ✅ Future: zones, categories, etc.
    zones: [
      {
        name: String,
        isActive: { type: Boolean, default: true },
      },
    ],

    // ✅ Audit
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("SystemSettings", SystemSettingsSchema);
