// backend/src/models/Payment.js
import mongoose from "mongoose";

export const PAYMENT_STATUSES = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED", // ✅ needed (used across routes)
  REFUND_REQUESTED: "REFUND_REQUESTED", // ✅ needed (async gateway refunds)
  REFUNDED: "REFUNDED",
};

const paymentSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    countryCode: {
      type: String,
      default: "ZA",
      uppercase: true,
      trim: true,
      index: true,
    },

    amount: { type: Number, required: true },
    currency: { type: String, default: "ZAR" },

    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.PENDING,
    },

    provider: { type: String, default: "PAYSTACK" },
    providerReference: { type: String, default: null },
    providerPayload: { type: Object, default: null },

    paidAt: { type: Date, default: null },

    manualMarkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    manualMarkedAt: { type: Date, default: null },

    refundedAt: { type: Date, default: null },
    refundReference: { type: String, default: null },
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    refundReason: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

paymentSchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();
  if (this.provider) this.provider = String(this.provider).trim().toUpperCase();
  next();
});

paymentSchema.index({ countryCode: 1, status: 1, createdAt: -1 });
paymentSchema.index({ job: 1, status: 1, createdAt: -1 });

paymentSchema.index(
  { job: 1, provider: 1, countryCode: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: PAYMENT_STATUSES.PAID },
  }
);

export default mongoose.models.Payment || mongoose.model("Payment", paymentSchema);