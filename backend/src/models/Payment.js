import mongoose from 'mongoose';

export const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED'
};

const paymentSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    amount: { type: Number, required: true },
    currency: { type: String, default: 'ZAR' },

    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.PENDING
    },

    // ✅ Placeholder fields for gateway integration
    provider: { type: String, default: "PAYSTACK" }, // Paystack, Stripe, etc
    providerReference: { type: String, default: null }, // Paystack reference
    providerPayload: { type: Object, default: null }, // Store full Paystack callback response

    // ✅ NEW ✅ Payment timestamps
    paidAt: { type: Date, default: null },

    // ✅ NEW ✅ Optional for refunds / disputes
    refundedAt: { type: Date, default: null },
    refundReference: { type: String, default: null }
  },
  { timestamps: true }
);

export default mongoose.model('Payment', paymentSchema);