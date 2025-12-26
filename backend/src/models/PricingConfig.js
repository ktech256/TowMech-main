import mongoose from 'mongoose';

const pricingConfigSchema = new mongoose.Schema(
  {
    currency: { type: String, default: 'ZAR' },

    baseFee: { type: Number, default: 50 },
    perKmFee: { type: Number, default: 15 },

    towTruckTypeMultipliers: {
      Flatbed: { type: Number, default: 1.2 },
      'Wheel-Lift': { type: Number, default: 1.0 },
      'Hook and Chain': { type: Number, default: 1.0 },
      'Heavy Duty Tow Truck': { type: Number, default: 2.0 },
      'Pickup with tow hitch': { type: Number, default: 0.9 },
      'Tow Dolly': { type: Number, default: 1.1 }
    },

    vehicleTypeMultipliers: {
      Sedan: { type: Number, default: 1.0 },
      SUV: { type: Number, default: 1.2 },
      Hatchback: { type: Number, default: 0.9 },
      Truck: { type: Number, default: 1.5 },
      Van: { type: Number, default: 1.4 }
    }
  },
  { timestamps: true }
);

export default mongoose.model('PricingConfig', pricingConfigSchema);
