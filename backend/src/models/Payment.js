import mongoose from "mongoose";

export const PAYMENT_STATUSES = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
};

const paymentSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    /**
     * ✅ TowMech Global routing
     * Every payment must belong to a country (tenant isolation)
     */
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

    // ✅ Placeholder fields for gateway integration
    provider: { type: String, default: "PAYSTACK" },
    providerReference: { type: String, default: null },
    providerPayload: { type: Object, default: null },

    // ✅ Payment timestamps
    paidAt: { type: Date, default: null },

    /**
     * ✅ Manual override audit trail
     * Records which Admin/SuperAdmin/Customer marked payment paid manually
     */
    manualMarkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    manualMarkedAt: { type: Date, default: null },

    // ✅ Refund related
    refundedAt: { type: Date, default: null },
    refundReference: { type: String, default: null },

    /**
     * ✅ Refund audit trail
     * Records which admin refunded payment
     */
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/**
 * ✅ Normalize countryCode
 */
paymentSchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();
  next();
});

// ✅ TowMech Global helpful index
paymentSchema.index({ countryCode: 1, status: 1, createdAt: -1 });

// ✅ Invoice performance indexes
paymentSchema.index({ job: 1, status: 1, createdAt: -1 });

export default mongoose.model("Payment", paymentSchema);