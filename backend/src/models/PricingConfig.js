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
     * ✅ TowTruck Type Pricing (NEW ✅ - Manual configuration per tow truck type)
     *
     * Each tow truck type can have its own:
     * - baseFee
     * - perKmFee
     * - nightFee
     * - weekendFee
     *
     * NOTE:
     * - This does NOT break anything because it is additive.
     * - Your pricing engine can use this first, and fall back to providerBasePricing.towTruck if missing.
     * - Aligned cheapest → most expensive (as requested).
     */
    towTruckTypePricing: {
      'Hook & Chain': {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 }
      },
      'Wheel-Lift': {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 }
      },
      'Flatbed/Roll Back': {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 }
      },
      'Boom Trucks(With Crane)': {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 }
      },
      'Integrated / Wrecker': {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 }
      },
      'Heavy-Duty Rotator(Recovery)': {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 }
      }
    },

    /**
     * ✅ TowTruck Multipliers (Type based)
     *
     * IMPORTANT:
     * - NEW preferred names are added and aligned cheapest → expensive
     * - Legacy keys are kept so existing DB values / old clients don’t break
     * - We do NOT change numbers/fees, only naming + ordering
     */
    towTruckTypeMultipliers: {
      // ✅ Legacy cheapest (kept for backward compatibility)
      'Pickup with tow hitch': { type: Number, default: 0.9 },

      // ✅ NEW preferred names (cheapest → most expensive)
      'Hook & Chain': { type: Number, default: 1.0 },
      'Wheel-Lift': { type: Number, default: 1.0 },
      'Boom Trucks(With Crane)': { type: Number, default: 1.1 },
      'Flatbed/Roll Back': { type: Number, default: 1.2 },
      'Integrated / Wrecker': { type: Number, default: 1.2 },
      'Heavy-Duty Rotator(Recovery)': { type: Number, default: 2.0 },

      // ✅ Legacy names (kept for backward compatibility)
      Flatbed: { type: Number, default: 1.2 },
      'Hook and Chain': { type: Number, default: 1.0 },
      'Heavy Duty Tow Truck': { type: Number, default: 2.0 },
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