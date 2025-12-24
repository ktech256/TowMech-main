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

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Broadcast mode (Bolt style)
    broadcastedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    lockedAt: { type: Date, default: null },

    status: {
      type: String,
      enum: Object.values(JOB_STATUSES),
      default: JOB_STATUSES.CREATED
    },

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
