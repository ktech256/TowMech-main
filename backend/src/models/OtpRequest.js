import mongoose from "mongoose";

/**
 * One-time OTP store for flows that are NOT tied to a User account yet.
 * Used by: /api/auth/country/send-otp and /api/auth/country/verify-otp
 */
const otpRequestSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true, unique: true },
    otpCode: { type: String, required: true },
    countryCode: { type: String, trim: true, uppercase: true },
    language: { type: String, trim: true, lowercase: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Auto-clean expired docs
otpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("OtpRequest", otpRequestSchema);