import mongoose from "mongoose";

const ZoneSchema = new mongoose.Schema(
  {
    /**
     * ✅ TowMech Global routing
     * Every zone belongs to a specific country (tenant isolation)
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
    isActive: { type: Boolean, default: true },

    // ✅ Audit
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/**
 * ✅ Normalize countryCode
 */
ZoneSchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();
  next();
});

/**
 * ✅ Prevent duplicates per country
 * (same zone name can exist in different countries)
 */
ZoneSchema.index({ countryCode: 1, name: 1 }, { unique: true });

export default mongoose.model("Zone", ZoneSchema);