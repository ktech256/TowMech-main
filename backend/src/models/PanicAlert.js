import mongoose from "mongoose";

export const PANIC_STATUSES = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
};

const PanicAlertSchema = new mongoose.Schema(
  {
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    triggeredRole: {
      type: String,
      required: true,
    },

    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
    },

    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },

    message: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: Object.values(PANIC_STATUSES),
      default: PANIC_STATUSES.OPEN,
    },

    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    resolvedAt: {
      type: Date,
      default: null,
    },

    auditLogs: [
      {
        action: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        meta: Object,
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("PanicAlert", PanicAlertSchema);
