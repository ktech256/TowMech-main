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

    // ✅ Placeholder fields for future gateway integration
    provider: { type: String, default: null }, // PayFast, Ozow, Stripe
    providerReference: { type: String, default: null }, // transaction ID
    providerPayload: { type: Object, default: null } // store callback response
  },
  { timestamps: true }
);

export default mongoose.model('Payment', paymentSchema);
