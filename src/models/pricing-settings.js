import mongoose from 'mongoose';

const pricingSettingsSchema = new mongoose.Schema(
  {
    baseMechanicFee: { type: Number, default: 0 },
    baseTowFee: { type: Number, default: 0 },
    perKmRate: { type: Number, default: 0 },
    effectiveFrom: { type: Date, default: Date.now },
    notes: { type: String }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('PricingSettings', pricingSettingsSchema);
