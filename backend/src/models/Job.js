import mongoose from 'mongoose';

export const JOB_STATUSES = {
  CREATED: 'CREATED',
  BROADCASTED: 'BROADCASTED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
};

export const BOOKING_FEE_STATUSES = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED'
};

export const PAYMENT_MODES = {
  DIRECT_TO_PROVIDER: 'DIRECT_TO_PROVIDER', // TowTruck: customer pays provider directly
  PAY_AFTER_COMPLETION: 'PAY_AFTER_COMPLETION' // Mechanic: customer pays after completion
};

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },

    roleNeeded: { type: String, required: true },

    pickupLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true } // [lng, lat]
    },

    dropoffLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: undefined
      },
      coordinates: {
        type: [Number],
        default: undefined
      }
    },

    pickupAddressText: { type: String, default: null },
    dropoffAddressText: { type: String, default: null },

    towTruckTypeNeeded: { type: String, default: null },
    vehicleType: { type: String, default: null },

    /**
     * ✅ Pricing block
     */
    pricing: {
      _id: false,

      currency: { type: String, default: 'ZAR' },

      baseFee: { type: Number, default: 0 },
      perKmFee: { type: Number, default: 0 },

      estimatedDistanceKm: { type: Number, default: 0 },

      towTruckTypeMultiplier: { type: Number, default: 1 },
      vehicleTypeMultiplier: { type: Number, default: 1 },

      surgeMultiplier: { type: Number, default: 1 },
      estimatedTotal: { type: Number, default: 0 },

      /**
       * ✅ Booking Fee System
       */
      bookingFee: { type: Number, default: 0 },

      bookingFeeStatus: {
        type: String,
        enum: Object.values(BOOKING_FEE_STATUSES),
        default: BOOKING_FEE_STATUSES.PENDING
      },

      bookingFeePaidAt: { type: Date, default: null },
      bookingFeeRefundedAt: { type: Date, default: null },

      bookingFeePercentUsed: { type: Number, default: null },
      mechanicBookingFeeUsed: { type: Number, default: null },

      /**
       * ✅ Revenue Split
       */
      commissionAmount: { type: Number, default: 0 },
      providerAmountDue: { type: Number, default: 0 }
    },

    paymentMode: {
      type: String,
      enum: Object.values(PAYMENT_MODES),
      default: PAYMENT_MODES.DIRECT_TO_PROVIDER
    },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    broadcastedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    excludedProviders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lockedAt: { type: Date, default: null },

    status: {
      type: String,
      enum: Object.values(JOB_STATUSES),
      default: JOB_STATUSES.CREATED
    },

    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },

    dispatchAttempts: [
      {
        providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        attemptedAt: { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
);

// ✅ Geo indexes
jobSchema.index({ pickupLocation: '2dsphere' });
jobSchema.index({ dropoffLocation: '2dsphere' });

export default mongoose.model('Job', jobSchema);