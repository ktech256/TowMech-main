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
  PAY_AFTER_COMPLETION: 'PAY_AFTER_COMPLETION' // Mechanic: customer pays after job complete
};

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },

    roleNeeded: { type: String, required: true }, // TowTruck or Mechanic

    pickupLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true } // [lng, lat]
    },

    // ✅ OPTIONAL (Only TowTruck jobs should have this)
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

    dropoffAddressText: { type: String, default: null },
    pickupAddressText: { type: String, default: null },

    towTruckTypeNeeded: { type: String, default: null },
    vehicleType: { type: String, default: null },

    /**
     * ✅ Pricing (Auto-calculated when job created)
     */
    pricing: {
      currency: { type: String, default: 'ZAR' },

      baseFee: { type: Number, default: 0 },
      perKmFee: { type: Number, default: 0 },

      estimatedDistanceKm: { type: Number, default: 0 },

      towTruckTypeMultiplier: { type: Number, default: 1 },
      vehicleTypeMultiplier: { type: Number, default: 1 },

      surgeMultiplier: { type: Number, default: 1 }, // ✅ store demand surge used
      estimatedTotal: { type: Number, default: 0 },

      /**
       * ✅ Booking Fee System
       * TowTruck = % of total
       * Mechanic = fixed
       */
      bookingFee: { type: Number, default: 0 },

      bookingFeeStatus: {
        type: String,
        enum: Object.values(BOOKING_FEE_STATUSES),
        default: BOOKING_FEE_STATUSES.PENDING
      },

      bookingFeePaidAt: { type: Date, default: null },
      bookingFeeRefundedAt: { type: Date, default: null },

      bookingFeePercentUsed: { type: Number, default: null }, // ✅ tow truck %
      mechanicBookingFeeUsed: { type: Number, default: null }, // ✅ mechanic fixed amount

      /**
       * ✅ Payout split
       * bookingFee = company commission
       * providerAmountDue = provider payout
       */
      commissionAmount: { type: Number, default: 0 },
      providerAmountDue: { type: Number, default: 0 }
    },

    /**
     * ✅ Payment Mode
     * TowTruck = customer pays provider directly
     * Mechanic = customer pays after completion
     */
    paymentMode: {
      type: String,
      enum: Object.values(PAYMENT_MODES),
      default: PAYMENT_MODES.DIRECT_TO_PROVIDER
    },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // ✅ Broadcast mode
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