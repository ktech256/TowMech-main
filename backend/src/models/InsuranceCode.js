// backend/src/models/InsuranceCode.js
import mongoose from "mongoose";

/**
 * InsuranceCode
 * - Codes are generated per InsurancePartner
 * - Customer selects InsurancePartner + enters a code
 * - Code MUST match partner (strictPartnerMatch)
 * - Code can be single-use or multi-use depending on partner settings
 */
const InsuranceCodeSchema = new mongoose.Schema(
  {
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InsurancePartner",
      required: true,
      index: true,
    },

    // Store partnerCode too for faster filtering + safety
    partnerCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    // Actual code user enters (unique per partner)
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    // Which country this code can be used in
    countryCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      default: "ZA",
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Expiry date (required)
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    /**
     * Usage tracking
     */
    usage: {
      usedCount: { type: Number, default: 0, min: 0 },
      maxUses: { type: Number, default: 1, min: 1 },

      // last time used
      lastUsedAt: { type: Date, default: null },

      // who used it last (customer)
      lastUsedByUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },

    /**
     * Optional: bind code to a specific customer phone/email if partner wants
     */
    restrictions: {
      boundToPhone: { type: String, default: "", trim: true },
      boundToEmail: { type: String, default: "", trim: true, lowercase: true },
    },

    /**
     * Audit
     */
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

/**
 * Unique constraint:
 * - code must be unique PER partner (not globally)
 */
InsuranceCodeSchema.index({ partner: 1, code: 1 }, { unique: true });

InsuranceCodeSchema.pre("save", function (next) {
  if (this.partnerCode) this.partnerCode = String(this.partnerCode).trim().toUpperCase();
  if (this.code) this.code = String(this.code).trim().toUpperCase();
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();
  next();
});

/**
 * Helper: can this code still be used?
 */
InsuranceCodeSchema.methods.canUse = function () {
  if (!this.isActive) return false;
  if (!this.expiresAt || this.expiresAt < new Date()) return false;

  const used = this.usage?.usedCount || 0;
  const max = this.usage?.maxUses || 1;

  return used < max;
};

const InsuranceCode =
  mongoose.models.InsuranceCode || mongoose.model("InsuranceCode", InsuranceCodeSchema);

export default InsuranceCode;