import mongoose from "mongoose";

const ServiceCategorySchema = new mongoose.Schema(
  {
    /**
     * ✅ TowMech Global routing
     * Every service category belongs to a country (tenant isolation)
     *
     * NOTE:
     * - Keep default "ZA" so old data continues working.
     * - Later dashboard can create per-country categories.
     */
    countryCode: {
      type: String,
      required: true,
      default: "ZA",
      uppercase: true,
      trim: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    // ✅ Provider type this service belongs to
    providerType: {
      type: String,
      required: true,
      enum: ["TOW_TRUCK", "MECHANIC"],
      index: true,
    },

    // ✅ Optional base price (can later help pricing calculations)
    basePrice: { type: Number, default: 0 },

    // ✅ Active toggle
    active: { type: Boolean, default: true },

    // ✅ Audit
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/**
 * ✅ Normalize countryCode
 */
ServiceCategorySchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();
  next();
});

/**
 * ✅ Avoid duplicates per country
 * Same service name + providerType can exist in another country.
 */
ServiceCategorySchema.index(
  { countryCode: 1, providerType: 1, name: 1 },
  { unique: true }
);

export default mongoose.model("ServiceCategory", ServiceCategorySchema);