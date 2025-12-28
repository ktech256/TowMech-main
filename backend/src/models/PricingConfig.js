import mongoose from 'mongoose';

const pricingConfigSchema = new mongoose.Schema(
  {
    currency: { type: String, default: 'ZAR' },

    /**
     * ✅ BASE PRICING
     */
    baseFee: { type: Number, default: 50 },
    perKmFee: { type: Number, default: 15 },

    /**
     * ✅ TowTruck Multipliers (Type based)
     */
    towTruckTypeMultipliers: {
      Flatbed: { type: Number, default: 1.2 },
      'Wheel-Lift': { type: Number, default: 1.0 },
      'Hook and Chain': { type: Number, default: 1.0 },
      'Heavy Duty Tow Truck': { type: Number, default: 2.0 },
      'Pickup with tow hitch': { type: Number, default: 0.9 },
      'Tow Dolly': { type: Number, default: 1.1 }
    },

    /**
     * ✅ Vehicle Multipliers
     */
    vehicleTypeMultipliers: {
      Sedan: { type: Number, default: 1.0 },
      SUV: { type: Number, default: 1.2 },
      Hatchback: { type: Number, default: 0.9 },
      Truck: { type: Number, default: 1.5 },
      Van: { type: Number, default: 1.4 }
    },

    /**
     * ✅ BOOKING / COMMITMENT FEES (Admin Controlled)
     * TowTruck: percentage-based
     * Mechanic: fixed amount
     */
    bookingFees: {
      towTruckPercent: { type: Number, default: 15 }, // ✅ stored as percent (15 = 15%)
      mechanicFixed: { type: Number, default: 200 } // ✅ fixed booking fee
    },

    /**
     * ✅ PAYOUT SPLIT RULES
     * TowTruck: customer pays provider directly, but we calculate expected payout split
     * Mechanic: paid after completion
     */
    payoutSplit: {
      towTruckProviderPercent: { type: Number, default: 85 }, // ✅ provider gets 85%
      towTruckCompanyPercent: { type: Number, default: 15 }, // ✅ company gets 15%
    },

    /**
     * ✅ DEMAND SURGE SETTINGS (Admin Controlled)
     * Pricing and booking fee can increase when demand is high
     */
    surgePricing: {
      enabled: { type: Boolean, default: true },

      // ✅ TowTruck surge multiplier
      towTruckMultiplier: { type: Number, default: 1.0 },

      // ✅ Mechanic surge multiplier
      mechanicMultiplier: { type: Number, default: 1.0 },

      // ✅ Mechanic booking fee surge multiplier
      mechanicBookingFeeMultiplier: { type: Number, default: 1.0 },

      // ✅ Safety cap (surge cannot go beyond this)
      maxSurgeMultiplier: { type: Number, default: 2.5 }
    },

    /**
     * ✅ REFUND RULES (Admin Controlled)
     */
    refundRules: {
      bookingFeeRefundableIfNoProviderFound: { type: Boolean, default: true },
      bookingFeeRefundableAfterMatch: { type: Boolean, default: false }
    },

    /**
     * ✅ PAYOUT RULES / DISCLAIMERS
     */
    payoutRules: {
      towTruckPaysProviderDirectly: { type: Boolean, default: true },
      mechanicPaysAfterCompletion: { type: Boolean, default: true },

      disclaimerText: {
        type: String,
        default:
          'Provider must ensure the customer pays directly. TowMech is not liable for unpaid amounts.'
      }
    }
  },
  { timestamps: true }
);

export default mongoose.model('PricingConfig', pricingConfigSchema);