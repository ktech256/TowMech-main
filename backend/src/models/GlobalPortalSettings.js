// backend/src/models/GlobalPortalSettings.js
import mongoose from "mongoose";

const GlobalPortalSettingsSchema = new mongoose.Schema(
  {
    fleetPortalEnabled: { type: Boolean, default: true },
    insurancePortalEnabled: { type: Boolean, default: true },
    emergencyShutdownMode: { type: Boolean, default: false },
    forceLogoutAllPartners: { type: Date, default: null }, // Partners with token issued before this date must re-login
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.models.GlobalPortalSettings || mongoose.model("GlobalPortalSettings", GlobalPortalSettingsSchema);
