import mongoose from 'mongoose';

export const JOB_STATUSES = {
  CREATED: 'CREATED',
  BROADCASTED: 'BROADCASTED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
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

    pickupAddressText: { type: String },

    towTruckTypeNeeded: { type: String }, // Flatbed etc
    vehicleType: { type: String }, // Sedan etc

    /**
     * ✅ Pricing (Auto-calculated when job created)
     * Admin controls baseFee and perKmFee via PricingConfig
     */
    pricing: {
      currency: { type: String, default: 'ZAR' },

      baseFee: { type: Number, default: 0 },
      perKmFee: { type: Number, default: 0 },

      estimatedDistanceKm: { type: Number, default: 0 },

      towTruckTypeMultiplier: { type: Number, default: 1 },
      vehicleTypeMultiplier: { type: Number, default: 1 },

      estimatedTotal: { type: Number, default: 0 }
    },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // ✅ Broadcast mode (Bolt style)
    broadcastedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // ✅ Providers excluded from rebroadcast (rejected/cancelled)
    excludedProviders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    lockedAt: { type: Date, default: null },

    status: {
      type: String,
      enum: Object.values(JOB_STATUSES),
      default: JOB_STATUSES.CREATED
    },

    // ✅ Cancellation tracking
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },

    // ✅ Dispatch tracking (who was attempted)
    dispatchAttempts: [
      {
        providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        attemptedAt: { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
);

// ✅ Geo index on pickup location
jobSchema.index({ pickupLocation: '2dsphere' });

export default mongoose.model('Job', jobSchema);
