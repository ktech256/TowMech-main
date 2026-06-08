// backend/src/models/FinancialLog.js
import mongoose from "mongoose";

const financialLogSchema = new mongoose.Schema(
  {
    action: {
        type: String,
        required: true,
        enum: ["INVOICE_GENERATED", "STATEMENT_GENERATED", "INVOICE_EDITED", "INVOICE_DOWNLOADED", "INVOICE_PAID", "PAYOUT_PROCESSED"]
    },
    entityType: { type: String, enum: ["INSURANCE", "PROVIDER"], required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true }, // e.g. InsurancePartner ID or Payout ID

    countryCode: { type: String, required: true, uppercase: true },

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    details: { type: mongoose.Schema.Types.Mixed },

    ip: String,
    userAgent: String
  },
  { timestamps: true }
);

financialLogSchema.index({ countryCode: 1, createdAt: -1 });
financialLogSchema.index({ entityId: 1 });

export default mongoose.model("FinancialLog", financialLogSchema);
