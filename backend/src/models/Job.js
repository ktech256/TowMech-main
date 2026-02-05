import mongoose from "mongoose";

export const JOB_STATUSES = {
  // ✅ Added for compatibility (safe)
  PENDING: "PENDING",

  CREATED: "CREATED",
  BROADCASTED: "BROADCASTED",
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

// ✅ FIX: include REFUND_REQUESTED so customer cancel does not crash
export const BOOKING_FEE_STATUSES = {
  PENDING: "PENDING",
  PAID: "PAID",

  // customer requested refund (awaiting processing)
  REFUND_REQUESTED: "REFUND_REQUESTED",

  REFUNDED: "REFUNDED",

  // optional: if refund attempt fails
  REFUND_FAILED: "REFUND_FAILED",
};

export const PAYMENT_MODES = {
  DIRECT_TO_PROVIDER: "DIRECT_TO_PROVIDER", // TowTruck: customer pays provider directly
  PAY_AFTER_COMPLETION: "PAY_AFTER_COMPLETION", // Mechanic: customer pays after completion
};

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },

    /**
     * description = general job notes (legacy)
     */
    description: { type: String },

    /**
     * ✅ NEW: customer brief problem description for mechanic jobs
     * This will help mechanic diagnose before arrival
     */
    customerProblemDescription: { type: String, default: null },

    /**
     * ✅ TowMech Global routing
     * Every job must belong to a country (tenant isolation)
     */
    countryCode: {
      type: String,
      default: "ZA",
      uppercase: true,
      trim: true,
      index: true,
    },

    roleNeeded: { type: String, required: true },

    pickupLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },

    dropoffLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: undefined,
      },
      coordinates: {
        type: [Number],
        default: undefined,
      },
    },

    pickupAddressText: { type: String, default: null },
    dropoffAddressText: { type: String, default: null },

    /**
     * TowTruck job requirement
     */
    towTruckTypeNeeded: { type: String, default: null },

    /**
     * ✅ NEW: Mechanic category requirement
     * Used for mechanic onboarding + filtering during mechanic job request
     */
    mechanicCategoryNeeded: { type: String, default: null },

    vehicleType: { type: String, default: null },

    /**
     * ✅ Insurance (NEW)
     * Stores code used to waive booking fee + for monthly invoicing
     */
    insurance: {
      _id: false,

      enabled: { type: Boolean, default: false },

      code: { type: String, default: null, trim: true },

      partnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "InsurancePartner",
        default: null,
      },

      validatedAt: { type: Date, default: null },
    },

    /**
     * ✅ Pricing block
     */
    pricing: {
      _id: false,

      currency: { type: String, default: "ZAR" },

      baseFee: { type: Number, default: 0 },
      perKmFee: { type: Number, default: 0 },

      estimatedDistanceKm: { type: Number, default: 0 },

      towTruckTypeMultiplier: { type: Number, default: 1 },
      vehicleTypeMultiplier: { type: Number, default: 1 },

      surgeMultiplier: { type: Number, default: 1 },

      /**
       * estimatedTotal is meaningful for TowTruck
       * For Mechanic we will keep it 0 (final fee unknown)
       */
      estimatedTotal: { type: Number, default: 0 },

      /**
       * ✅ Booking Fee System
       */
      bookingFee: { type: Number, default: 0 },

      bookingFeeStatus: {
        type: String,
        enum: Object.values(BOOKING_FEE_STATUSES),
        default: BOOKING_FEE_STATUSES.PENDING,
      },

      bookingFeePaidAt: { type: Date, default: null },
      bookingFeeRefundedAt: { type: Date, default: null },

      bookingFeePercentUsed: { type: Number, default: null },
      mechanicBookingFeeUsed: { type: Number, default: null },

      /**
       * ✅ Revenue Split
       */
      commissionAmount: { type: Number, default: 0 },
      providerAmountDue: { type: Number, default: 0 },
    },

    /**
     * ✅ Disclaimers for mechanic pricing behavior
     */
    disclaimers: {
      _id: false,

      mechanicFinalFeeNotPredetermined: {
        type: Boolean,
        default: false,
      },

      text: {
        type: String,
        default: null,
      },
    },

    paymentMode: {
      type: String,
      enum: Object.values(PAYMENT_MODES),
      default: PAYMENT_MODES.DIRECT_TO_PROVIDER,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    broadcastedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    excludedProviders: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", default: [] }],

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ✅ used for chat unlock + cancel/refund windows
    lockedAt: { type: Date, default: null },

    status: {
      type: String,
      enum: Object.values(JOB_STATUSES),
      default: JOB_STATUSES.CREATED,
    },

    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },

    dispatchAttempts: [
      {
        providerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        attemptedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,

    // ✅ IMPORTANT: include virtuals in API JSON output
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ✅ Geo indexes
jobSchema.index({ pickupLocation: "2dsphere" });
jobSchema.index({ dropoffLocation: "2dsphere" });

// ✅ Helpful indexes (non-breaking, performance only)
jobSchema.index({ lockedAt: 1 });
jobSchema.index({ assignedTo: 1, status: 1 });

// ✅ TowMech Global index (country isolation + filtering)
jobSchema.index({ countryCode: 1, status: 1, createdAt: -1 });

// ✅ Insurance invoice indexes
jobSchema.index({ "insurance.enabled": 1, countryCode: 1, createdAt: -1 });
jobSchema.index({ "insurance.partnerId": 1, countryCode: 1, createdAt: -1 });
jobSchema.index({ "insurance.validatedAt": 1 });

/**
 * ✅ Ensure countryCode + insurance.code normalized
 */
jobSchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();

  if (this.insurance?.code) {
    this.insurance.code = String(this.insurance.code).trim().toUpperCase();
  }

  next();
});

/**
 * ✅ Virtuals for Android compatibility:
 * Backend stores coordinates as [lng, lat]
 * App expects pickupLat/pickupLng, dropoffLat/dropoffLng
 */
jobSchema.virtual("pickupLng").get(function () {
  const c = this.pickupLocation?.coordinates;
  return Array.isArray(c) && c.length >= 2 ? c[0] : null;
});

jobSchema.virtual("pickupLat").get(function () {
  const c = this.pickupLocation?.coordinates;
  return Array.isArray(c) && c.length >= 2 ? c[1] : null;
});

jobSchema.virtual("dropoffLng").get(function () {
  const c = this.dropoffLocation?.coordinates;
  return Array.isArray(c) && c.length >= 2 ? c[0] : null;
});

jobSchema.virtual("dropoffLat").get(function () {
  const c = this.dropoffLocation?.coordinates;
  return Array.isArray(c) && c.length >= 2 ? c[1] : null;
});

export default mongoose.model("Job", jobSchema);