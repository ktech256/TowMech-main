import mongoose from 'mongoose';

const pricingConfigSchema = new mongoose.Schema(
  {
    currency: { type: String, default: 'ZAR' },

    /**
     * ✅ BASE PRICING (Legacy Global Pricing - Keep for backward compatibility)
     */
    baseFee: { type: Number, default: 50 },
    perKmFee: { type: Number, default: 15 },

    /**
     * ✅ Provider Type Base Pricing (NEW ✅)
     * TowTruck and Mechanic can have different pricing
     * Includes Night Fee + Weekend Fee incentives
     */
    providerBasePricing: {
      towTruck: {
        baseFee: { type: Number, default: 50 },
        perKmFee: { type: Number, default: 15 },
        nightFee: { type: Number, default: 0 }, // extra added at night
        weekendFee: { type: Number, default: 0 } // extra added on weekends
      },
      mechanic: {
        baseFee: { type: Number, default: 30 },
        perKmFee: { type: Number, default: 10 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 }
      }
    },

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
      towTruckPercent: { type: Number, default: 15 }, // 15 = 15%
      mechanicFixed: { type: Number, default: 200 }
    },

    /**
     * ✅ PAYOUT SPLIT RULES
     */
    payoutSplit: {
      towTruckProviderPercent: { type: Number, default: 85 },
      towTruckCompanyPercent: { type: Number, default: 15 }
    },

    /**
     * ✅ SURGE SETTINGS
     */
    surgePricing: {
      enabled: { type: Boolean, default: true },

      towTruckMultiplier: { type: Number, default: 1.0 },
      mechanicMultiplier: { type: Number, default: 1.0 },
      mechanicBookingFeeMultiplier: { type: Number, default: 1.0 },

      maxSurgeMultiplier: { type: Number, default: 2.5 }
    },

    /**
     * ✅ REFUND RULES
     */
    refundRules: {
      bookingFeeRefundableIfNoProviderFound: { type: Boolean, default: true },
      bookingFeeRefundableAfterMatch: { type: Boolean, default: false }
    },

    /**
     * ✅ DISCLAIMERS / RULES
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
  { timestamps: true, strict: true }
);

export default mongoose.model('PricingConfig', pricingConfigSchema);
