import mongoose from "mongoose";

const weeklyPayoutSchema = new mongoose.Schema(
  {
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    countryCode: { type: String, required: true, index: true },

    weekStartDate: { type: Date, required: true }, // Monday 00:00:00
    weekEndDate: { type: Date, required: true },   // Next Monday 00:00:00

    // Detailed breakdown per day: "YYYY-MM-DD" -> Amount
    dailyBreakdown: {
      type: Map,
      of: Number,
      default: {},
    },

    // List of jobs included in this payout
    jobs: [{
      job: { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
      amount: Number,
      completedAt: Date
    }],

    totalAmount: { type: Number, default: 0 },
    currency: { type: String, default: "ZAR" },

    status: {
      type: String,
      enum: ["PENDING", "PAID"],
      default: "PENDING",
      index: true
    },

    paidAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // For auditing/logging
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Prevent duplicate payout for same provider same week
weeklyPayoutSchema.index({ provider: 1, weekStartDate: 1 }, { unique: true });

export default mongoose.model("WeeklyPayout", weeklyPayoutSchema);