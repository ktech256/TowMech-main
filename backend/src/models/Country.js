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

    // ✅ Language tags
    defaultLanguage: { type: String, default: "en", lowercase: true, trim: true },
    supportedLanguages: { type: [String], default: ["en"] },

    timezone: { type: String, default: "Africa/Johannesburg", trim: true },

    isActive: { type: Boolean, default: true },

    // ✅ IMPORTANT for /api/config/countries public list:
    // Older controller filters by isPublic; if missing, countries won't return.
    // This does not change any non-language logic; it prevents public list from breaking.
    isPublic: { type: Boolean, default: true, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/**
 * ✅ Language name -> tag
 * Safety net: if dashboard ever sends "Afrikaans" instead of "af",
 * the DB still stores "af" (and app locale switching works).
 */
const LANGUAGE_NAME_TO_TAG = {
  english: "en",
  afrikaans: "af",
  arabic: "ar",
  bengali: "bn",
  bulgarian: "bg",
  catalan: "ca",
  "chinese (simplified)": "zh-Hans",
  "chinese (traditional)": "zh-Hant",
  chinese: "zh",
  croatian: "hr",
  czech: "cs",
  danish: "da",
  dutch: "nl",
  estonian: "et",
  finnish: "fi",
  french: "fr",
  german: "de",
  greek: "el",
  hebrew: "he",
  hindi: "hi",
  hungarian: "hu",
  indonesian: "id",
  italian: "it",
  japanese: "ja",
  korean: "ko",
  latvian: "lv",
  lithuanian: "lt",
  malay: "ms",
  norwegian: "no",
  persian: "fa",
  farsi: "fa",
  polish: "pl",
  portuguese: "pt",
  "portuguese (brazil)": "pt-BR",
  "portuguese (brasil)": "pt-BR",
  "brazilian portuguese": "pt-BR",
  romanian: "ro",
  russian: "ru",
  serbian: "sr",
  slovak: "sk",
  slovenian: "sl",
  spanish: "es",
  swedish: "sv",
  thai: "th",
  turkish: "tr",
  ukrainian: "uk",
  urdu: "ur",
  vietnamese: "vi",

  // Africa + SA focus
  swahili: "sw",
  kiswahili: "sw",
  amharic: "am",
  hausa: "ha",
  igbo: "ig",
  yoruba: "yo",
  somali: "so",
  shona: "sn",
  chichewa: "ny",
  kinyarwanda: "rw",
  kirundi: "rn",
  lingala: "ln",
  luganda: "lg",
  oromo: "om",
  tigrinya: "ti",
  isizulu: "zu",
  isixhosa: "xh",
  sesotho: "st",
  "sesotho sa leboa": "nso",
  setswana: "tn",
  xitsonga: "ts",
  tsonga: "ts",
  siswati: "ss",
  swati: "ss",
  venda: "ve",
  tshivenda: "ve",
  ndebele: "nr",
};

function looksLikeLangTag(v) {
  return /^[A-Za-z]{2,3}([_-][A-Za-z]{4})?([_-][A-Za-z]{2}|\d{3})?([_-][A-Za-z0-9]{5,8})*$/.test(
    String(v || "").trim()
  );
}

function normalizeLangTag(v) {
  const raw = String(v || "").trim();
  if (!raw) return "en";

  const byName = LANGUAGE_NAME_TO_TAG[raw.toLowerCase()];
  if (byName) return byName;

  if (looksLikeLangTag(raw)) {
    const cleaned = raw.replace(/_/g, "-").replace(/\s+/g, "");
    const parts = cleaned.split("-").filter(Boolean);
    if (parts.length) {
      parts[0] = parts[0].toLowerCase();
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].length === 2) parts[i] = parts[i].toUpperCase();
        else if (parts[i].length === 4)
          parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
      }
    }
    return parts.join("-");
  }

  const simplified = raw
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return LANGUAGE_NAME_TO_TAG[simplified] || "en";
}

// ✅ Normalization (safe)
CountrySchema.pre("validate", function (next) {
  if (this.code) this.code = String(this.code).trim().toUpperCase();
  if (this.currency) this.currency = String(this.currency).trim().toUpperCase();

  if (this.currencyDisplay != null) {
    const x = String(this.currencyDisplay).trim();
    this.currencyDisplay = x ? x : null;
  }

  // ✅ LANGUAGE FIX: force tags (Afrikaans -> af, Kiswahili -> sw, etc.)
  if (this.defaultLanguage) this.defaultLanguage = normalizeLangTag(this.defaultLanguage);

  if (Array.isArray(this.supportedLanguages)) {
    this.supportedLanguages = this.supportedLanguages
      .map((x) => normalizeLangTag(x))
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