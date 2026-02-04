// backend/src/models/Country.js
import mongoose from "mongoose";

const CountrySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },

    // ✅ ISO code / backend currency value (usually uppercase)
    currency: { type: String, required: true, uppercase: true, trim: true },

    /**
     * ✅ NEW: Display currency label/prefix (what app shows)
     * Examples: "Ksh", "ZAR", "Ugx", "ZIG", "Tsh"
     * If not set, app should fallback to `currency`.
     */
    currencyDisplay: { type: String, default: null, trim: true },

    /**
     * ✅ Country dialing code like "+27", "+256"
     * Standardized field name in DB: dialingCode
     */
    dialingCode: { type: String, default: null, trim: true, index: true },

    defaultLanguage: { type: String, default: "en", lowercase: true, trim: true },

    supportedLanguages: { type: [String], default: ["en"] },

    timezone: { type: String, default: "Africa/Johannesburg", trim: true },

    isActive: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// ✅ Normalization (safe)
CountrySchema.pre("validate", function (next) {
  if (this.code) this.code = String(this.code).trim().toUpperCase();
  if (this.currency) this.currency = String(this.currency).trim().toUpperCase();

  if (this.currencyDisplay != null) {
    const x = String(this.currencyDisplay).trim();
    this.currencyDisplay = x ? x : null;
  }

  if (this.defaultLanguage) this.defaultLanguage = String(this.defaultLanguage).trim().toLowerCase();

  if (Array.isArray(this.supportedLanguages)) {
    this.supportedLanguages = this.supportedLanguages
      .map((x) => String(x).trim().toLowerCase())
      .filter(Boolean);
    if (this.supportedLanguages.length === 0) this.supportedLanguages = ["en"];
  }

  if (this.dialingCode) {
    let s = String(this.dialingCode).trim();
    if (s && !s.startsWith("+") && /^\d+$/.test(s)) s = `+${s}`;
    s = s.replace(/[^\d+]/g, "");
    this.dialingCode = /^\+\d{1,4}$/.test(s) ? s : this.dialingCode;
  }

  next();
});

export default mongoose.models.Country || mongoose.model("Country", CountrySchema);