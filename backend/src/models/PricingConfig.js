import mongoose from "mongoose";

/**
 * ✅ Default Mechanic Categories (used across the app)
 */
const DEFAULT_MECHANIC_CATEGORIES = [
  "General Mechanic",
  "Engine Mechanic",
  "Gearbox Mechanic",
  "Suspension & Alignment",
  "Tyre and rims",
  "Car wiring and Diagnosis",
];

/**
 * ✅ Default TowTruck Types (used across the app)
 */
const DEFAULT_TOW_TRUCK_TYPES = [
  "Hook & Chain",
  "Wheel-Lift",
  "Flatbed/Roll Back",
  "Boom Trucks(With Crane)",
  "Integrated / Wrecker",
  "Heavy-Duty Rotator(Recovery)",
];

/**
 * ✅ Default Mechanic Category Pricing
 * bookingFee = baseFee + (nightFee if night) + (weekendFee if weekend)
 */
const DEFAULT_MECHANIC_CATEGORY_PRICING = {
  "General Mechanic": { baseFee: 0, nightFee: 0, weekendFee: 0 },
  "Engine Mechanic": { baseFee: 0, nightFee: 0, weekendFee: 0 },
  "Gearbox Mechanic": { baseFee: 0, nightFee: 0, weekendFee: 0 },
  "Suspension & Alignment": { baseFee: 0, nightFee: 0, weekendFee: 0 },
  "Tyre and rims": { baseFee: 0, nightFee: 0, weekendFee: 0 },
  "Car wiring and Diagnosis": { baseFee: 0, nightFee: 0, weekendFee: 0 },
};

const pricingConfigSchema = new mongoose.Schema(
  {
    /**
     * ✅ TowMech Global routing
     * Every pricing config belongs to a country (tenant isolation)
     *
     * NOTE:
     * - Keep default "ZA" so old data continues working.
     * - Later dashboard can create configs per country.
     */
    countryCode: {
      type: String,
      required: true,
      default: "ZA",
      uppercase: true,
      trim: true,
      index: true,
    },

    currency: { type: String, default: "ZAR" },

    /**
     * ✅ BASE PRICING (Legacy Global Pricing - Keep for backward compatibility)
     */
    baseFee: { type: Number, default: 50 },
    perKmFee: { type: Number, default: 15 },

    /**
     * ✅ Provider Type Base Pricing
     */
    providerBasePricing: {
      towTruck: {
        baseFee: { type: Number, default: 50 },
        perKmFee: { type: Number, default: 15 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 },
      },
      mechanic: {
        baseFee: { type: Number, default: 30 },
        perKmFee: { type: Number, default: 10 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 },
      },
    },

    /**
     * ✅ TowTruck Types List (used by jobs preview screen)
     */
    towTruckTypes: {
      type: [String],
      default: DEFAULT_TOW_TRUCK_TYPES,
    },

    /**
     * ✅ Mechanic Categories List (used by onboarding + job request)
     */
    mechanicCategories: {
      type: [String],
      default: DEFAULT_MECHANIC_CATEGORIES,
    },

    /**
     * ✅ Mechanic Category Pricing (Dashboard Controlled)
     * bookingFee = baseFee + (nightFee if night) + (weekendFee if weekend)
     *
     * IMPORTANT:
     * We use Mixed so dashboard can update freely without schema issues.
     */
    mechanicCategoryPricing: {
      type: mongoose.Schema.Types.Mixed,
      default: DEFAULT_MECHANIC_CATEGORY_PRICING,
    },

    /**
     * ✅ TowTruck Type Pricing
     */
    towTruckTypePricing: {
      "Hook & Chain": {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 },
      },
      "Wheel-Lift": {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 },
      },
      "Flatbed/Roll Back": {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 },
      },
      "Boom Trucks(With Crane)": {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 },
      },
      "Integrated / Wrecker": {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 },
      },
      "Heavy-Duty Rotator(Recovery)": {
        baseFee: { type: Number, default: 20 },
        perKmFee: { type: Number, default: 20 },
        nightFee: { type: Number, default: 0 },
        weekendFee: { type: Number, default: 0 },
      },
    },

    /**
     * ✅ TowTruck Multipliers (Type based)
     */
    towTruckTypeMultipliers: {
      "Pickup with tow hitch": { type: Number, default: 0.9 },

      "Hook & Chain": { type: Number, default: 1.0 },
      "Wheel-Lift": { type: Number, default: 1.0 },
      "Boom Trucks(With Crane)": { type: Number, default: 1.1 },
      "Flatbed/Roll Back": { type: Number, default: 1.2 },
      "Integrated / Wrecker": { type: Number, default: 1.2 },
      "Heavy-Duty Rotator(Recovery)": { type: Number, default: 2.0 },

      // legacy aliases (safe)
      Flatbed: { type: Number, default: 1.2 },
      "Hook and Chain": { type: Number, default: 1.0 },
      "Heavy Duty Tow Truck": { type: Number, default: 2.0 },
      "Tow Dolly": { type: Number, default: 1.1 },
    },

    /**
     * ✅ Vehicle Multipliers
     */
    vehicleTypeMultipliers: {
      Sedan: { type: Number, default: 1.0 },
      SUV: { type: Number, default: 1.2 },
      Hatchback: { type: Number, default: 1.0 },
      Truck: { type: Number, default: 1.5 },
      Van: { type: Number, default: 1.4 },
    },

    /**
     * ✅ BOOKING FEES (Legacy + fallback)
     */
    bookingFees: {
      towTruckPercent: { type: Number, default: 15 },
      mechanicFixed: { type: Number, default: 200 },
    },

    payoutSplit: {
      towTruckProviderPercent: { type: Number, default: 85 },
      towTruckCompanyPercent: { type: Number, default: 15 },
    },

    surgePricing: {
      enabled: { type: Boolean, default: true },

      towTruckMultiplier: { type: Number, default: 1.0 },
      mechanicMultiplier: { type: Number, default: 1.0 },
      mechanicBookingFeeMultiplier: { type: Number, default: 1.0 },

      maxSurgeMultiplier: { type: Number, default: 2.5 },
    },

    refundRules: {
      bookingFeeRefundableIfNoProviderFound: { type: Boolean, default: true },
      bookingFeeRefundableAfterMatch: { type: Boolean, default: false },
    },

    payoutRules: {
      towTruckPaysProviderDirectly: { type: Boolean, default: true },
      mechanicPaysAfterCompletion: { type: Boolean, default: true },

      disclaimerText: {
        type: String,
        default:
          "Provider must ensure the customer pays directly. TowMech is not liable for unpaid amounts.",
      },
    },
  },
  { timestamps: true, strict: true }
);

/**
 * ✅ Normalize countryCode
 */
pricingConfigSchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();
  next();
});

/**
 * ✅ Only one PricingConfig per country
 */
pricingConfigSchema.index({ countryCode: 1 }, { unique: true });

export default mongoose.model("PricingConfig", pricingConfigSchema);