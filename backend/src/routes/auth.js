// backend/src/routes/auth.js

import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import auth from "../middleware/auth.js";
import User, {
  USER_ROLES,
  TOW_TRUCK_TYPES,
  MECHANIC_CATEGORIES,
} from "../models/User.js";

// ✅ PricingConfig source of truth for dashboard-controlled categories/types
import PricingConfig from "../models/PricingConfig.js";

// ✅ Country (to resolve dialing code)
import Country from "../models/Country.js";

// ✅ SMS provider (Twilio) — SAFE import for ESM/Render
import twilioPkg from "twilio";
const twilio = twilioPkg?.default || twilioPkg;

const router = express.Router();

// ✅ warn if missing (won’t crash boot, but highlights misconfig)
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing in environment variables");
}

// ✅ Helper: Generate JWT token (now includes sid to prevent multi-device login)
const generateToken = (userId, role, sessionId = null) =>
  jwt.sign({ id: userId, role, sid: sessionId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

/**
 * ✅ i18n safe helpers (works even if middleware not mounted)
 */
function getReqLang(req) {
  const fromBody = req.body?.language;
  const fromHeader = req.headers["x-language"] || req.headers["accept-language"];
  const fromMiddleware = req.lang;

  const raw = (fromMiddleware || fromBody || fromHeader || "en").toString().trim();
  // keep only first tag: "en-US,en;q=0.9" -> "en-US"
  return raw.split(",")[0].trim() || "en";
}

function t(req, key, vars = {}) {
  if (typeof req.t === "function") return req.t(key, vars);
  // fallback: just use vars.fallback when middleware is not present
  return vars.fallback || key;
}

/**
 * ✅ Normalize phone for consistent login + uniqueness (RAW)
 */
function normalizePhone(phone) {
  if (!phone) return "";
  let p = String(phone).trim();

  p = p.replace(/\s+/g, "");
  p = p.replace(/[-()]/g, "");

  // If someone sends "00.." convert to +..
  if (p.startsWith("00")) p = "+" + p.slice(2);

  return p;
}

/**
 * ✅ Resolve request countryCode (tenant middleware normally sets req.countryCode)
 */
function resolveReqCountryCode(req) {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query?.country ||
    req.query?.countryCode ||
    req.body?.countryCode ||
    process.env.DEFAULT_COUNTRY ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
}

/**
 * ✅ Dialing code fallback (safe)
 */
const DIALING_CODE_FALLBACK = {
  ZA: "+27",
  KE: "+254",
  UG: "+256",
};

/**
 * ✅ Load dialing code for a country (DB first, fallback map)
 */
async function getDialingCodeForCountry(countryCode) {
  const cc = String(countryCode || "ZA").trim().toUpperCase();

  try {
    const c = await Country.findOne({ code: cc }).select("dialingCode phoneRules code");
    const fromDb =
      c?.dialingCode ||
      c?.phoneRules?.dialingCode ||
      c?.phoneRules?.countryDialingCode ||
      null;

    if (fromDb && typeof fromDb === "string" && fromDb.trim()) {
      const d = fromDb.trim();
      return d.startsWith("+") ? d : `+${d}`;
    }
  } catch (_e) {
    // ignore and fallback
  }

  return DIALING_CODE_FALLBACK[cc] || null;
}

/**
 * ✅ Convert phone to E.164-ish for sending ONLY (Twilio requires +)
 */
function toE164PhoneForSms(phone, dialingCode = null) {
  const p = normalizePhone(phone);
  if (!p) return "";

  if (p.startsWith("+")) return p;

  const digitsOnly = p.replace(/[^\d]/g, "");
  if (!digitsOnly) return p;

  if (dialingCode) {
    const dialDigits = String(dialingCode).replace("+", "");
    if (digitsOnly.startsWith(dialDigits)) return `+${digitsOnly}`;
  }

  if (dialingCode && /^0\d{6,14}$/.test(digitsOnly)) {
    return `${dialingCode}${digitsOnly.slice(1)}`;
  }

  if (dialingCode && /^\d{7,12}$/.test(digitsOnly)) {
    return `${dialingCode}${digitsOnly}`;
  }

  if (/^\d{7,15}$/.test(digitsOnly)) return `+${digitsOnly}`;

  return p;
}

/**
 * ✅ build multiple phone candidates to match DB formats
 */
function buildPhoneCandidates(phone, dialingCode = null) {
  const p = normalizePhone(phone);
  const candidates = new Set();
  if (!p) return [];

  candidates.add(p);

  if (p.startsWith("+")) candidates.add(p.slice(1));

  const digitsOnly = p.replace(/[^\d]/g, "");
  if (digitsOnly) {
    candidates.add(digitsOnly);
    candidates.add("+" + digitsOnly);
  }

  if (dialingCode) {
    const dialDigits = String(dialingCode).replace("+", "");

    if (/^\d{7,15}$/.test(digitsOnly) && digitsOnly.startsWith(dialDigits)) {
      candidates.add("+" + digitsOnly);
    }

    if (/^0\d{6,14}$/.test(digitsOnly)) {
      candidates.add(`${dialingCode}${digitsOnly.slice(1)}`);
      candidates.add(`${dialDigits}${digitsOnly.slice(1)}`);
    }

    if (/^\d{7,12}$/.test(digitsOnly) && !digitsOnly.startsWith(dialDigits)) {
      candidates.add(`${dialingCode}${digitsOnly}`);
      candidates.add(`${dialDigits}${digitsOnly}`);
    }
  }

  if (/^0\d{9}$/.test(p)) {
    candidates.add("+27" + p.slice(1));
    candidates.add("27" + p.slice(1));
  }
  if (/^27\d{9}$/.test(p)) {
    candidates.add("+" + p);
  }

  return Array.from(candidates);
}

/**
 * ✅ STATIC OTP (Play Store review / internal testing)
 */
const STATIC_TEST_OTP = "123456";
const STATIC_TEST_PHONES_LOCAL = new Set([
  "0731110001",
  "0731110002",
  "0731110003",
  "0731110004",
  "0731110005",
]);

function toLocalZaPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return "";

  const clean = p.replace(/[^\d+]/g, "");

  if (/^0\d{9}$/.test(clean)) return clean;

  if (/^\+27\d{9}$/.test(clean)) return "0" + clean.slice(3);
  if (/^27\d{9}$/.test(clean)) return "0" + clean.slice(2);

  const digits = clean.replace(/[^\d]/g, "");
  if (/^0\d{9}$/.test(digits)) return digits;

  return "";
}

function isStaticOtpTestPhone(phone) {
  const local = toLocalZaPhone(phone);
  return !!local && STATIC_TEST_PHONES_LOCAL.has(local);
}

/**
 * ✅ Send OTP via SMS (Twilio)
 * ✅ NOW LANGUAGE-AWARE (langTag optional)
 */
async function sendOtpSms(phone, otpCode, purpose = "OTP", dialingCode = null, langTag = "en") {
  const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";
  if (debugEnabled) {
    console.log(
      `🟧 OTP_DEBUG (${purpose}) → phone=${normalizePhone(phone)} | otp=${otpCode} | lang=${langTag}`
    );
  }

  if (isStaticOtpTestPhone(phone)) {
    console.log(
      `🧪 STATIC OTP MODE (${purpose}) → SMS SKIPPED for`,
      toLocalZaPhone(phone),
      "| OTP:",
      otpCode
    );
    return { ok: true, provider: "static" };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  const to = toE164PhoneForSms(phone, dialingCode);

  if (!sid || !token || !from) {
    console.log("⚠️ TWILIO NOT CONFIGURED → SMS NOT SENT");
    console.log(`📲 ${purpose} SHOULD HAVE BEEN SENT TO:`, to, "| OTP:", otpCode);
    return { ok: false, provider: "none" };
  }

  if (!to || !to.startsWith("+")) {
    console.error("❌ SMS OTP SEND FAILED: Invalid 'To' Phone Number:", phone, "->", to);
    return { ok: false, provider: "twilio", error: "Invalid destination phone number" };
  }

  const client = twilio(sid, token);

  // ✅ very simple SMS language (uses only en/pt/sw for now)
  const lang = String(langTag || "en").toLowerCase();
  const sms = (() => {
    if (lang.startsWith("pt")) {
      if (purpose === "RESET") return `Código de redefinição TowMech: ${otpCode}. Expira em 10 minutos.`;
      if (purpose === "COUNTRY") return `Código de confirmação do país TowMech: ${otpCode}. Expira em 10 minutos.`;
      return `Seu OTP TowMech é: ${otpCode}. Expira em 10 minutos.`;
    }
    if (lang.startsWith("sw")) {
      if (purpose === "RESET") return `Nambari ya kurejesha nenosiri TowMech: ${otpCode}. Inaisha baada ya dakika 10.`;
      if (purpose === "COUNTRY") return `Nambari ya kuthibitisha nchi TowMech: ${otpCode}. Inaisha baada ya dakika 10.`;
      return `OTP yako ya TowMech ni: ${otpCode}. Inaisha baada ya dakika 10.`;
    }
    // default English
    if (purpose === "RESET") return `TowMech password reset code: ${otpCode}. Expires in 10 minutes.`;
    if (purpose === "COUNTRY") return `TowMech country confirmation code: ${otpCode}. Expires in 10 minutes.`;
    return `Your TowMech OTP is: ${otpCode}. It expires in 10 minutes.`;
  })();

  await client.messages.create({ body: sms, from, to });

  return { ok: true, provider: "twilio" };
}

/**
 * ✅ Helper: Validate South African ID (Luhn algorithm)
 */
function isValidSouthAfricanID(id) {
  if (!id || typeof id !== "string") return false;
  if (!/^\d{13}$/.test(id)) return false;

  let sum = 0;
  let alternate = false;

  for (let i = id.length - 1; i >= 0; i--) {
    let n = parseInt(id[i], 10);

    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }

    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

/**
 * ✅ Helper: Validate passport number (8–11 alphanumeric)
 */
function isValidPassport(passport) {
  if (!passport || typeof passport !== "string") return false;
  const clean = passport.trim();
  return /^[a-zA-Z0-9]{8,11}$/.test(clean);
}

/**
 * ✅ Helper: Normalize towTruckTypes
 */
function normalizeTowTruckTypes(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];

  return list
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((x) => {
      const lower = x.toLowerCase();

      if (lower.includes("hook") && lower.includes("chain")) return "Hook & Chain";
      if (lower === "wheel-lift" || lower === "wheel lift") return "Wheel-Lift";

      if (
        lower === "flatbed" ||
        lower === "rollback" ||
        lower === "roll back" ||
        lower === "flatbed/roll back" ||
        lower === "flatbed/rollback" ||
        lower === "flatbed/rollback"
      )
        return "Flatbed/Roll Back";

      if (lower.includes("boom")) return "Boom Trucks(With Crane)";
      if (lower.includes("integrated") || lower.includes("wrecker")) return "Integrated / Wrecker";
      if (lower.includes("rotator") || lower.includes("heavy-duty") || lower === "recovery")
        return "Heavy-Duty Rotator(Recovery)";

      if (lower === "towtruck") return "TowTruck";
      if (lower === "towtruck-xl" || lower === "towtruck xl") return "TowTruck-XL";
      if (lower === "towtruck-xxl" || lower === "towtruck xxl") return "TowTruck-XXL";
      if (lower === "flatbed") return "Flatbed";
      if (lower === "rollback") return "Rollback";
      if (lower === "recovery") return "Recovery";

      return x;
    });
}

/**
 * ✅ Helper: Normalize mechanic categories
 */
function normalizeMechanicCategories(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * ✅ Allowed types/categories should come from PricingConfig (dashboard)
 * ✅ FIX: COUNTRY-PARALLEL (per countryCode)
 */
async function getAllowedProviderTypesFromPricingConfig(countryCode) {
  const cc = String(countryCode || process.env.DEFAULT_COUNTRY || "ZA")
    .trim()
    .toUpperCase();

  let pricing = await PricingConfig.findOne({ countryCode: cc });
  if (!pricing) pricing = await PricingConfig.create({ countryCode: cc });

  const allowedTowTruckTypes =
    Array.isArray(pricing.towTruckTypes) && pricing.towTruckTypes.length > 0
      ? pricing.towTruckTypes
      : TOW_TRUCK_TYPES;

  const allowedMechanicCategories =
    Array.isArray(pricing.mechanicCategories) && pricing.mechanicCategories.length > 0
      ? pricing.mechanicCategories
      : MECHANIC_CATEGORIES;

  return { pricing, allowedTowTruckTypes, allowedMechanicCategories, countryCode: cc };
}

/**
 * ✅ Helper: Generate OTP + save
 */
async function generateAndSaveOtp(user, { minutes = 10 } = {}) {
  const useStatic = isStaticOtpTestPhone(user?.phone);
  const otpCode = useStatic ? STATIC_TEST_OTP : crypto.randomInt(100000, 999999).toString();

  user.otpCode = otpCode;
  user.otpExpiresAt = new Date(Date.now() + minutes * 60 * 1000);
  await user.save();

  return otpCode;
}

function isProviderRole(role) {
  return role === USER_ROLES.TOW_TRUCK || role === USER_ROLES.MECHANIC;
}

/**
 * ✅ COUNTRY OTP (PERSISTED IN MONGO)
 */
const COUNTRY_OTP_TTL_MINUTES = 10;

const CountryOtpSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true, unique: true },
    countryCode: { type: String, required: true, index: true },
    phoneNormalized: { type: String, required: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

CountryOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const CountryOtp = mongoose.models.CountryOtp || mongoose.model("CountryOtp", CountryOtpSchema);

function buildCountryOtpKey(phoneCandidate, countryCode) {
  return `${String(countryCode || "ZA").toUpperCase()}::${String(phoneCandidate || "").trim()}`;
}

function generateCountryOtpCode(phone) {
  if (isStaticOtpTestPhone(phone)) return STATIC_TEST_OTP;
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * ✅ CHECK PHONE EXISTS
 */
router.post("/check-phone", async (req, res) => {
  try {
    const { phone, countryCode } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({
        message: t(req, "errors.phone_required", { fallback: "phone is required" }),
        exists: false,
      });
    }

    const requestCountryCode = (countryCode || resolveReqCountryCode(req))
      .toString()
      .trim()
      .toUpperCase();

    const dialingCode = await getDialingCodeForCountry(requestCountryCode);
    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    const userInCountry = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    }).select("_id phone role countryCode");

    const userAnywhere = await User.findOne({
      phone: { $in: phoneCandidates },
    }).select("_id phone role countryCode");

    return res.status(200).json({
      exists: !!userInCountry,
      existsInThisCountry: !!userInCountry,
      existsAnywhere: !!userAnywhere,
      role: userInCountry?.role || userAnywhere?.role || null,
      countryCode: requestCountryCode,
      matchedUserCountryCode: userInCountry?.countryCode || userAnywhere?.countryCode || null,
    });
  } catch (err) {
    console.error("❌ CHECK PHONE ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.check_phone_failed", { fallback: "Check phone failed" }),
      error: err.message,
      exists: false,
    });
  }
});

/**
 * ✅ Backward compatibility: POST /api/auth/phone-exists
 */
router.post("/phone-exists", async (req, res) => {
  try {
    const { phone, countryCode } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({
        message: t(req, "errors.phone_required", { fallback: "phone is required" }),
        exists: false,
      });
    }

    const requestCountryCode = (countryCode || resolveReqCountryCode(req))
      .toString()
      .trim()
      .toUpperCase();

    const dialingCode = await getDialingCodeForCountry(requestCountryCode);
    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    const userInCountry = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    }).select("_id role countryCode");

    const userAnywhere = await User.findOne({
      phone: { $in: phoneCandidates },
    }).select("_id role countryCode");

    return res.status(200).json({
      exists: !!userInCountry,
      existsInThisCountry: !!userInCountry,
      existsAnywhere: !!userAnywhere,
      role: userInCountry?.role || userAnywhere?.role || null,
      countryCode: requestCountryCode,
      matchedUserCountryCode: userInCountry?.countryCode || userAnywhere?.countryCode || null,
    });
  } catch (err) {
    console.error("❌ PHONE EXISTS ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.phone_check_failed", { fallback: "Phone check failed" }),
      error: err.message,
      exists: false,
    });
  }
});

/**
 * ✅ Register user
 */
router.post("/register", async (req, res) => {
  try {
    console.log("🟦 REGISTER HIT ✅");
    console.log("📩 REGISTER BODY:", req.body);

    const {
      firstName,
      lastName,
      phone,
      email,
      password,
      birthday,
      nationalityType,
      saIdNumber,
      passportNumber,
      country,
      role = USER_ROLES.CUSTOMER,
      towTruckTypes,
      mechanicCategories,
    } = req.body;

    if (!Object.values(USER_ROLES).includes(role)) {
      return res.status(400).json({
        message: t(req, "errors.invalid_role", { fallback: "Invalid role provided" }),
      });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);
    const normalizedPhone = normalizePhone(phone);

    if (role === USER_ROLES.SUPER_ADMIN || role === USER_ROLES.ADMIN) {
      const emailClean = (email || "").trim().toLowerCase();

      const existing = await User.findOne({
        countryCode: requestCountryCode,
        email: emailClean,
      });

      if (existing) return res.status(409).json({ message: t(req, "errors.user_exists", { fallback: "User already exists" }) });

      const user = await User.create({
        name: `${firstName || "Admin"} ${lastName || ""}`.trim(),
        firstName: firstName || "Admin",
        lastName: lastName || "",
        phone: normalizedPhone || "",
        email: emailClean,
        password,
        birthday: birthday || null,
        role,
        countryCode: requestCountryCode,
      });

      return res.status(201).json({
        message: t(req, "auth.register_success", { fallback: "User registered successfully ✅" }),
        user: { id: user._id, name: user.name, email: user.email, role: user.role },
      });
    }

    if (!firstName || !lastName || !normalizedPhone || !email || !password || !birthday) {
      return res.status(400).json({
        message: t(req, "errors.register_required_fields", {
          fallback: "firstName, lastName, phone, email, password, birthday are required",
        }),
      });
    }

    /**
     * ✅ CHANGE: Customer ID/Passport is OPTIONAL
     * - Customers may still send nationalityType, saIdNumber, passportNumber, country
     * - If provided, we validate; if missing, we allow registration
     * - Providers/admin remain unchanged (providers still require documents as before via their own flows)
     */
    if (role !== USER_ROLES.CUSTOMER) {
      if (!nationalityType || !["SouthAfrican", "ForeignNational"].includes(nationalityType)) {
        return res.status(400).json({
          message: t(req, "errors.invalid_nationality_type", {
            fallback: "nationalityType must be SouthAfrican or ForeignNational",
          }),
        });
      }

      if (nationalityType === "SouthAfrican") {
        if (!saIdNumber)
          return res.status(400).json({ message: t(req, "errors.sa_id_required", { fallback: "saIdNumber is required for SouthAfrican" }) });
        if (!isValidSouthAfricanID(saIdNumber))
          return res.status(400).json({ message: t(req, "errors.invalid_sa_id", { fallback: "Invalid South African ID number" }) });
      }

      if (nationalityType === "ForeignNational") {
        if (!passportNumber || !country) {
          return res.status(400).json({
            message: t(req, "errors.foreign_required", { fallback: "passportNumber and country are required for ForeignNational" }),
          });
        }
        if (!isValidPassport(passportNumber)) {
          return res.status(400).json({
            message: t(req, "errors.invalid_passport", { fallback: "passportNumber must be 8 to 11 alphanumeric characters" }),
          });
        }
      }
    } else {
      // CUSTOMER: nationalityType can be present (or not); ID/Passport is optional
      if (nationalityType && !["SouthAfrican", "ForeignNational"].includes(nationalityType)) {
        return res.status(400).json({
          message: t(req, "errors.invalid_nationality_type", {
            fallback: "nationalityType must be SouthAfrican or ForeignNational",
          }),
        });
      }

      // Validate only if provided
      if (nationalityType === "SouthAfrican" && saIdNumber) {
        if (!isValidSouthAfricanID(saIdNumber)) {
          return res.status(400).json({
            message: t(req, "errors.invalid_sa_id", { fallback: "Invalid South African ID number" }),
          });
        }
      }

      if (nationalityType === "ForeignNational" && passportNumber) {
        if (!isValidPassport(passportNumber)) {
          return res.status(400).json({
            message: t(req, "errors.invalid_passport", {
              fallback: "passportNumber must be 8 to 11 alphanumeric characters",
            }),
          });
        }
      }
      // country is optional for customer (even if ForeignNational)
    }

    const { allowedTowTruckTypes, allowedMechanicCategories } =
      await getAllowedProviderTypesFromPricingConfig(requestCountryCode);

    let normalizedTowTypes = [];
    if (role === USER_ROLES.TOW_TRUCK) {
      normalizedTowTypes = normalizeTowTruckTypes(towTruckTypes);

      if (!normalizedTowTypes.length) {
        return res.status(400).json({
          message: t(req, "errors.towtruck_type_required", {
            fallback: "TowTruck providers must select at least 1 towTruckType",
          }),
        });
      }

      const invalid = normalizedTowTypes.filter((tt) => !allowedTowTruckTypes.includes(tt));
      if (invalid.length > 0) {
        return res.status(400).json({
          message: t(req, "errors.invalid_towtruck_types", { fallback: `Invalid towTruckTypes: ${invalid.join(", ")}` }),
          allowed: allowedTowTruckTypes,
        });
      }
    }

    let normalizedMechCats = [];
    if (role === USER_ROLES.MECHANIC) {
      normalizedMechCats = normalizeMechanicCategories(mechanicCategories);

      if (!normalizedMechCats.length) {
        return res.status(400).json({
          message: t(req, "errors.mechanic_category_required", {
            fallback: "Mechanics must select at least 1 mechanic category",
          }),
        });
      }

      const invalid = normalizedMechCats.filter((c) => !allowedMechanicCategories.includes(c));
      if (invalid.length > 0) {
        return res.status(400).json({
          message: t(req, "errors.invalid_mechanic_categories", { fallback: `Invalid mechanicCategories: ${invalid.join(", ")}` }),
          allowed: allowedMechanicCategories,
        });
      }
    }

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);
    const emailClean = String(email).trim().toLowerCase();

    const existingEmail = await User.findOne({
      countryCode: requestCountryCode,
      email: emailClean,
    });
    if (existingEmail) return res.status(409).json({ message: t(req, "errors.email_exists", { fallback: "Email already registered" }) });

    const existingPhone = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });
    if (existingPhone) return res.status(409).json({ message: t(req, "errors.phone_exists", { fallback: "Phone number already registered" }) });

    const name = `${firstName.trim()} ${lastName.trim()}`;

    const user = await User.create({
      name,
      firstName,
      lastName,
      phone: normalizedPhone,
      email: emailClean,
      password,
      birthday,
      countryCode: requestCountryCode,

      // ✅ keep storing if provided; for customers these may be null/empty and that's OK
      nationalityType: nationalityType || null,
      saIdNumber: nationalityType === "SouthAfrican" ? (saIdNumber || null) : null,
      passportNumber: nationalityType === "ForeignNational" ? (passportNumber || null) : null,
      country: nationalityType === "ForeignNational" ? (country || null) : null,

      role,
      providerProfile:
        role !== USER_ROLES.CUSTOMER
          ? {
              towTruckTypes: role === USER_ROLES.TOW_TRUCK ? normalizedTowTypes : [],
              mechanicCategories: role === USER_ROLES.MECHANIC ? normalizedMechCats : [],
              isOnline: false,
              verificationStatus: "PENDING",
              sessionId: null,
              sessionIssuedAt: null,
            }
          : undefined,
    });

    return res.status(201).json({
      message: t(req, "auth.register_success", { fallback: "User registered successfully ✅" }),
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("❌ REGISTER ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.registration_failed", { fallback: "Registration failed" }),
      error: err.message,
    });
  }
});

/**
 * ✅ Login → ALWAYS OTP
 */
router.post("/login", async (req, res) => {
  try {
    console.log("✅ LOGIN ROUTE HIT ✅", req.body);

    const { phone, password } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !password) {
      return res.status(400).json({
        message: t(req, "errors.phone_password_required", { fallback: "phone and password are required" }),
      });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    let user = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });

    if (!user) {
      user = await User.findOne({
        $and: [
          { phone: { $in: phoneCandidates } },
          { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] },
        ],
      });
    }

    if (!user) return res.status(401).json({ message: t(req, "errors.invalid_credentials", { fallback: "Invalid credentials" }) });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ message: t(req, "errors.invalid_credentials", { fallback: "Invalid credentials" }) });

    if (!user.countryCode) {
      user.countryCode = requestCountryCode;
      await user.save();
    }

    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";
    if (debugEnabled) console.log(`🟧 OTP_DEBUG (LOGIN) → userPhone=${user.phone} | otp=${otpCode}`);

    const userDialingCode = await getDialingCodeForCountry(user.countryCode || requestCountryCode);

    try {
      await sendOtpSms(user.phone, otpCode, "OTP", userDialingCode, getReqLang(req));
    } catch (smsErr) {
      console.error("❌ SMS OTP SEND FAILED:", smsErr.message);
    }

    return res.status(200).json({
      message: t(req, "auth.otp_sent", { fallback: "OTP sent via SMS ✅" }),
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
      isStaticOtpAccount: isStaticOtpTestPhone(user.phone),
      countryCode: user.countryCode || requestCountryCode,
    });
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.login_failed", { fallback: "Login failed" }),
      error: err.message,
    });
  }
});

/**
 * ✅ VERIFY OTP
 */
router.post("/verify-otp", async (req, res) => {
  try {
    console.log("✅ VERIFY OTP HIT ✅", req.body);

    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !otp) {
      return res.status(400).json({
        message: t(req, "errors.phone_otp_required", { fallback: "phone and otp are required" }),
      });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    let user = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });

    if (!user) {
      user = await User.findOne({
        $and: [
          { phone: { $in: phoneCandidates } },
          { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] },
        ],
      });
    }

    if (!user) return res.status(404).json({ message: t(req, "errors.user_not_found", { fallback: "User not found" }) });

    if (!user.otpCode || user.otpCode !== otp) {
      return res.status(401).json({ message: t(req, "errors.invalid_otp", { fallback: "Invalid OTP" }) });
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(401).json({ message: t(req, "errors.otp_expired", { fallback: "OTP expired" }) });
    }

    user.otpCode = null;
    user.otpExpiresAt = null;

    let sessionId = null;

    if (isProviderRole(user.role)) {
      if (!user.providerProfile) {
        user.providerProfile = {
          isOnline: false,
          verificationStatus: "PENDING",
          location: { type: "Point", coordinates: [0, 0] },
          towTruckTypes: [],
          mechanicCategories: [],
        };
      }

      sessionId = crypto.randomBytes(24).toString("hex");
      user.providerProfile.sessionId = sessionId;
      user.providerProfile.sessionIssuedAt = new Date();
      user.providerProfile.isOnline = false;
    }

    if (!user.countryCode) user.countryCode = requestCountryCode;

    await user.save();

    const token = generateToken(user._id, user.role, sessionId);

    return res.status(200).json({
      message: t(req, "auth.otp_verified", { fallback: "OTP verified ✅" }),
      token,
      user:
        typeof user.toSafeJSON === "function"
          ? user.toSafeJSON(user.role)
          : {
              _id: user._id,
              id: user._id,
              name: user.name,
              email: user.email,
              role: user.role,
              countryCode: user.countryCode,
              permissions: user.permissions || {},
            },
      countryCode: user.countryCode || requestCountryCode,
    });
  } catch (err) {
    console.error("❌ VERIFY OTP ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.otp_verification_failed", { fallback: "OTP verification failed" }),
      error: err.message,
    });
  }
});

/**
 * ✅✅✅ COUNTRY OTP (NO TOKEN, NO USER)
 * POST /api/auth/country/send-otp
 */
router.post("/country/send-otp", async (req, res) => {
  try {
    const { phone } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({ message: t(req, "errors.phone_required", { fallback: "phone is required" }) });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const otpCode = generateCountryOtpCode(normalizedPhone);
    const expiresAt = new Date(Date.now() + COUNTRY_OTP_TTL_MINUTES * 60 * 1000);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);
    const keys = phoneCandidates.map((cand) => buildCountryOtpKey(String(cand), requestCountryCode));

    await Promise.all(
      keys.map((key) =>
        CountryOtp.updateOne(
          { key },
          {
            $set: {
              key,
              countryCode: requestCountryCode,
              phoneNormalized: normalizedPhone,
              otp: String(otpCode),
              expiresAt,
            },
          },
          { upsert: true }
        )
      )
    );

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";
    if (debugEnabled) {
      console.log(
        `🟧 OTP_DEBUG (COUNTRY_SEND) → phone=${normalizedPhone} | country=${requestCountryCode} | otp=${otpCode}`
      );
    }

    const smsDialingCode = dialingCode || DIALING_CODE_FALLBACK[requestCountryCode] || null;
    try {
      await sendOtpSms(normalizedPhone, otpCode, "COUNTRY", smsDialingCode, getReqLang(req));
    } catch (smsErr) {
      console.error("❌ COUNTRY SMS SEND FAILED:", smsErr.message);
    }

    return res.status(200).json({
      message: t(req, "auth.country_otp_sent", { fallback: "Country OTP sent via SMS ✅" }),
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
      isStaticOtpAccount: isStaticOtpTestPhone(normalizedPhone),
      countryCode: requestCountryCode,
      expiresInMinutes: COUNTRY_OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error("❌ COUNTRY SEND OTP ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.country_otp_send_failed", { fallback: "Country OTP send failed" }),
      error: err.message,
    });
  }
});

/**
 * ✅✅✅ COUNTRY OTP VERIFY (NO TOKEN, NO USER)
 * POST /api/auth/country/verify-otp
 */
router.post("/country/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !otp) {
      return res.status(400).json({
        message: t(req, "errors.phone_otp_required", { fallback: "phone and otp are required" }),
      });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);
    const keys = phoneCandidates.map((cand) => buildCountryOtpKey(String(cand), requestCountryCode));

    const rec = await CountryOtp.findOne({ key: { $in: keys } }).select("otp expiresAt key");
    if (!rec) {
      return res.status(404).json({
        message: t(req, "errors.no_otp_request", {
          fallback: "No OTP request found for this phone. Please request OTP again.",
        }),
      });
    }

    if (!rec.expiresAt || rec.expiresAt < new Date()) {
      await CountryOtp.deleteMany({ key: { $in: keys } });
      return res.status(401).json({ message: t(req, "errors.otp_expired", { fallback: "OTP expired" }) });
    }

    if (String(rec.otp) !== String(otp).trim()) {
      return res.status(401).json({ message: t(req, "errors.invalid_otp", { fallback: "Invalid OTP" }) });
    }

    await CountryOtp.deleteMany({ key: { $in: keys } });

    return res.status(200).json({
      message: t(req, "auth.country_confirmed", { fallback: "Country confirmed ✅" }),
      countryCode: requestCountryCode,
    });
  } catch (err) {
    console.error("❌ COUNTRY VERIFY OTP ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.country_otp_verify_failed", { fallback: "Country OTP verification failed" }),
      error: err.message,
    });
  }
});

/**
 * ✅ Forgot Password → sends OTP via SMS
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({ message: t(req, "errors.phone_required", { fallback: "phone is required" }) });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    let user = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });

    if (!user) {
      user = await User.findOne({
        $and: [
          { phone: { $in: phoneCandidates } },
          { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] },
        ],
      });
    }

    // ✅ keep same behavior: don’t leak whether phone exists
    if (!user) {
      return res.status(200).json({
        message: t(req, "auth.forgot_generic", { fallback: "If your phone exists, an SMS code has been sent ✅" }),
      });
    }

    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";
    if (debugEnabled) console.log(`🟧 OTP_DEBUG (FORGOT) → userPhone=${user.phone} | otp=${otpCode}`);

    const userDialingCode = await getDialingCodeForCountry(user.countryCode || requestCountryCode);

    try {
      await sendOtpSms(user.phone, otpCode, "RESET", userDialingCode, getReqLang(req));
    } catch (smsErr) {
      console.error("❌ RESET SMS SEND FAILED:", smsErr.message);
    }

    return res.status(200).json({
      message: t(req, "auth.forgot_generic", { fallback: "If your phone exists, an SMS code has been sent ✅" }),
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
      isStaticOtpAccount: isStaticOtpTestPhone(user.phone),
      countryCode: user.countryCode || requestCountryCode,
    });
  } catch (err) {
    console.error("❌ FORGOT PASSWORD ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.forgot_failed", { fallback: "Forgot password failed" }),
      error: err.message,
    });
  }
});

/**
 * ✅ Reset Password
 */
router.post("/reset-password", async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !otp || !newPassword) {
      return res.status(400).json({
        message: t(req, "errors.reset_required", { fallback: "phone, otp, newPassword are required" }),
      });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    let user = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });

    if (!user) {
      user = await User.findOne({
        $and: [
          { phone: { $in: phoneCandidates } },
          { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] },
        ],
      });
    }

    if (!user) return res.status(404).json({ message: t(req, "errors.user_not_found", { fallback: "User not found" }) });

    if (!user.otpCode || user.otpCode !== otp) {
      return res.status(401).json({ message: t(req, "errors.invalid_otp", { fallback: "Invalid OTP" }) });
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(401).json({ message: t(req, "errors.otp_expired", { fallback: "OTP expired" }) });
    }

    user.password = newPassword;
    user.otpCode = null;
    user.otpExpiresAt = null;

    if (!user.countryCode) user.countryCode = requestCountryCode;

    await user.save();

    return res.status(200).json({
      message: t(req, "auth.reset_success", { fallback: "Password reset successful ✅" }),
    });
  } catch (err) {
    console.error("❌ RESET PASSWORD ERROR:", err.message);
    return res.status(500).json({
      message: t(req, "errors.reset_failed", { fallback: "Reset password failed" }),
      error: err.message,
    });
  }
});

/**
 * ✅ Get logged-in user profile
 */
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "name firstName lastName email phone birthday nationalityType saIdNumber passportNumber country role providerProfile countryCode permissions createdAt updatedAt"
    );

    if (!user) return res.status(404).json({ message: t(req, "errors.user_not_found", { fallback: "User not found" }) });

    const safe = typeof user.toSafeJSON === "function" ? user.toSafeJSON(user.role) : user;

    if (safe && safe.countryCode == null && safe.country) safe.countryCode = safe.country;
    if (safe && !safe.permissions) safe.permissions = {};

    return res.status(200).json({ user: safe });
  } catch (err) {
    return res.status(500).json({ message: t(req, "errors.fetch_profile_failed", { fallback: "Could not fetch profile" }), error: err.message });
  }
});

/**
 * ✅ Update logged-in user profile (phone/email/password only)
 */
router.patch("/me", auth, async (req, res) => {
  try {
    const userId = req.user?._id;
    const { phone, email, password } = req.body || {};

    const updates = {};
    if (typeof phone === "string" && phone.trim()) updates.phone = normalizePhone(phone);
    if (typeof email === "string" && email.trim()) updates.email = email.trim().toLowerCase();
    if (typeof password === "string" && password.trim()) updates.password = password.trim();

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ message: t(req, "errors.nothing_to_update", { fallback: "Nothing to update" }) });

    const currentUser = await User.findById(userId).select("countryCode");
    if (!currentUser) return res.status(404).json({ message: t(req, "errors.user_not_found", { fallback: "User not found" }) });

    const tenantCountryCode = String(currentUser.countryCode || resolveReqCountryCode(req))
      .trim()
      .toUpperCase();

    if (updates.email) {
      const existingEmail = await User.findOne({
        countryCode: tenantCountryCode,
        email: updates.email,
        _id: { $ne: userId },
      });
      if (existingEmail) return res.status(409).json({ message: t(req, "errors.email_exists", { fallback: "Email already registered" }) });
    }

    if (updates.phone) {
      const dialingCode = await getDialingCodeForCountry(tenantCountryCode);
      const candidates = buildPhoneCandidates(updates.phone, dialingCode);

      const existingPhone = await User.findOne({
        countryCode: tenantCountryCode,
        phone: { $in: candidates },
        _id: { $ne: userId },
      });
      if (existingPhone) return res.status(409).json({ message: t(req, "errors.phone_exists", { fallback: "Phone number already registered" }) });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: t(req, "errors.user_not_found", { fallback: "User not found" }) });

    if (updates.phone) user.phone = updates.phone;
    if (updates.email) user.email = updates.email;
    if (updates.password) user.password = updates.password;

    await user.save();

    const fresh = await User.findById(userId).select(
      "name firstName lastName email phone birthday nationalityType saIdNumber passportNumber country role providerProfile countryCode permissions createdAt updatedAt"
    );

    const safe = typeof fresh.toSafeJSON === "function" ? fresh.toSafeJSON(fresh.role) : fresh;
    if (safe && !safe.permissions) safe.permissions = {};
    if (safe && safe.countryCode == null && safe.country) safe.countryCode = safe.country;

    return res.status(200).json({
      message: t(req, "auth.profile_updated", { fallback: "Profile updated ✅" }),
      user: safe,
    });
  } catch (err) {
    return res.status(500).json({ message: t(req, "errors.update_failed", { fallback: "Update failed" }), error: err.message });
  }
});

/**
 * ✅ Logout
 */
router.post("/logout", auth, async (req, res) => {
  try {
    const userId = req.user?._id;

    const user = await User.findById(userId).select("role fcmToken providerProfile");
    if (!user) return res.status(404).json({ message: t(req, "errors.user_not_found", { fallback: "User not found" }) });

    const isProvider = isProviderRole(user.role);

    user.fcmToken = null;

    if (isProvider) {
      if (!user.providerProfile) user.providerProfile = {};
      user.providerProfile.fcmToken = null;
      user.providerProfile.isOnline = false;
      user.providerProfile.sessionId = null;
      user.providerProfile.sessionIssuedAt = null;
    }

    await user.save();

    return res.status(200).json({
      message: t(req, "auth.logged_out", { fallback: "Logged out ✅" }),
      cleared: {
        rootFcmToken: true,
        providerFcmToken: isProvider,
        providerSessionInvalidated: isProvider,
      },
    });
  } catch (err) {
    console.error("❌ LOGOUT ERROR:", err);
    return res.status(500).json({ message: t(req, "errors.logout_failed", { fallback: "Logout failed" }), error: err.message });
  }
});

export default router;