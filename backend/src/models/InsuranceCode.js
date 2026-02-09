// backend/src/models/InsuranceCode.js
import mongoose from "mongoose";

const InsuranceCodeSchema = new mongoose.Schema(
  {
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InsurancePartner",
      required: true,
      index: true,
    },

    partnerCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

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

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    usage: {
      usedCount: { type: Number, default: 0, min: 0 },
      maxUses: { type: Number, default: 1, min: 1 },
      lastUsedAt: { type: Date, default: null },
      lastUsedByUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },

    restrictions: {
      boundToPhone: { type: String, default: "", trim: true },
      boundToEmail: { type: String, default: "", trim: true, lowercase: true },
    },

    /**
     * ✅ Soft lock to prevent concurrent claims
     * - used in job request flow
     * - DOES NOT mean "usedCount" was incremented
     */
    lock: {
      isLocked: { type: Boolean, default: false, index: true },
      lockedAt: { type: Date, default: null },
      lockedUntil: { type: Date, default: null, index: true },
      lockedByUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true,
      },
      lockedByJob: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Job",
        default: null,
        index: true,
      },
    },

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

InsuranceCodeSchema.index({ partner: 1, code: 1 }, { unique: true });

InsuranceCodeSchema.pre("save", function (next) {
  if (this.partnerCode) this.partnerCode = String(this.partnerCode).trim().toUpperCase();
  if (this.code) this.code = String(this.code).trim().toUpperCase();
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();
  next();
});

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