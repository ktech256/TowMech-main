// backend/src/models/FinancialLog.js
import mongoose from "mongoose";

const financialLogSchema = new mongoose.Schema(
  {
    action: {
        type: String,
        required: true,
        enum: [
          "INVOICE_GENERATED", "STATEMENT_GENERATED", "INVOICE_EDITED",
          "INVOICE_DOWNLOADED", "INVOICE_PAID", "PAYOUT_PROCESSED",
          "PARTNER_CODE_CREATED", "PARTNER_CODE_REVOKED", "PARTNER_CODE_USED",
          "DRIVER_LINKED", "INSURANCE_CODE_VALIDATED",
          "PARTNER_LOGIN", "PARTNER_LOGOUT", "PORTAL_DISABLED", "PORTAL_ENABLED",
          "PARTNER_CREATED", "INVITATION_SENT", "INVITATION_FAILED",
          "ACTIVATION_COMPLETED", "PASSWORD_CREATED", "OTP_SENT", "OTP_VERIFIED",
          "EMAIL_SENT", "EMAIL_FAILED"
        ]
    },
    entityType: { type: String, enum: ["INSURANCE", "PROVIDER", "PARTNER", "FLEET", "CUSTOMER", "SYSTEM"], required: true },
    entityId: { type: mongoose.Schema.Types.Mixed, required: false }, // Supports ObjectId or String (e.g. "SYSTEM")

    countryCode: { type: String, required: true, uppercase: true },

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false }, // Optional for SYSTEM actions

    details: { type: mongoose.Schema.Types.Mixed },

    ip: String,
    userAgent: String
  },
  { timestamps: true }
);

financialLogSchema.index({ countryCode: 1, createdAt: -1 });
financialLogSchema.index({ entityId: 1 });

export default mongoose.model("FinancialLog", financialLogSchema);
