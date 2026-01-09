import mongoose from "mongoose";

const notificationLogSchema = new mongoose.Schema(
  {
    // ✅ Who sent it (Admin / SuperAdmin)
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ Target settings
    audience: {
      type: String,
      enum: ["ALL", "CUSTOMERS", "PROVIDERS"],
      default: "ALL",
    },

    providerRole: {
      type: String,
      enum: ["TOW_TRUCK", "MECHANIC", "ALL"],
      default: "ALL",
    },

    title: { type: String, required: true },
    body: { type: String, required: true },

    // ✅ Stats
    totalTargets: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },

    // ✅ Optional errors
    errors: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        message: String,
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("NotificationLog", notificationLogSchema);
