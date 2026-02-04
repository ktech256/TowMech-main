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
 * - If already + => keep
 * - If digits-only => try to prefix + (Twilio expects +)
 * - If local leading 0 => needs dialing code, so we attempt with cc if provided
 */
function toE164PhoneForSms(phone, dialingCode = null) {
  const p = normalizePhone(phone);
  if (!p) return "";

  if (p.startsWith("+")) return p;

  const digitsOnly = p.replace(/[^\d]/g, "");
  if (!digitsOnly) return p;

  // If already starts with dialing digits and dial known
  if (dialingCode) {
    const dialDigits = String(dialingCode).replace("+", "");
    if (digitsOnly.startsWith(dialDigits)) return `+${digitsOnly}`;
  }

  // Local 0xxxx...
  if (dialingCode && /^0\d{6,14}$/.test(digitsOnly)) {
    return `${dialingCode}${digitsOnly.slice(1)}`;
  }

  // If short digits and dial exists, prefix
  if (dialingCode && /^\d{7,12}$/.test(digitsOnly)) {
    return `${dialingCode}${digitsOnly}`;
  }

  // Fallback: just add +
  if (/^\d{7,15}$/.test(digitsOnly)) return `+${digitsOnly}`;

  return p;
}

/**
 * ✅ build multiple phone candidates to match DB formats
 * Now supports multi-country:
 * - candidates include:
 *   "+<dial><national>", "<dial><national>", raw, and ZA legacy.
 */
function buildPhoneCandidates(phone, dialingCode = null) {
  const p = normalizePhone(phone);
  const candidates = new Set();
  if (!p) return [];

  candidates.add(p);

  // remove + variant
  if (p.startsWith("+")) candidates.add(p.slice(1));

  const digitsOnly = p.replace(/[^\d]/g, "");
  if (digitsOnly) {
    candidates.add(digitsOnly);
    candidates.add("+" + digitsOnly);
  }

  // If dialing code known, generate normalized storage candidates
  if (dialingCode) {
    const dialDigits = String(dialingCode).replace("+", "");

    // already has dial digits without +
    if (/^\d{7,15}$/.test(digitsOnly) && digitsOnly.startsWith(dialDigits)) {
      candidates.add("+" + digitsOnly);
    }

    // local 0xxxxx => dial + rest
    if (/^0\d{6,14}$/.test(digitsOnly)) {
      candidates.add(`${dialingCode}${digitsOnly.slice(1)}`); // +2547...
      candidates.add(`${dialDigits}${digitsOnly.slice(1)}`); // 2547...
    }

    // short national digits => prefix dialing code
    if (/^\d{7,12}$/.test(digitsOnly) && !digitsOnly.startsWith(dialDigits)) {
      candidates.add(`${dialingCode}${digitsOnly}`);
      candidates.add(`${dialDigits}${digitsOnly}`);
    }
  }

  /**
   * ✅ Keep your original ZA legacy compatibility (unchanged)
   */
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

/**
 * Convert any accepted SA format to local 0XXXXXXXXX for matching.
 */
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
 * ✅ OTP DEBUG: logs OTP to Render logs when ENABLE_OTP_DEBUG=true
 */
async function sendOtpSms(phone, otpCode, purpose = "OTP", dialingCode = null) {
  const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";
  if (debugEnabled) {
    console.log(`🟧 OTP_DEBUG (${purpose}) → phone=${normalizePhone(phone)} | otp=${otpCode}`);
  }

  // ✅ Static OTP numbers: do NOT send SMS
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

  const message =
    purpose === "RESET"
      ? `TowMech password reset code: ${otpCode}. Expires in 10 minutes.`
      : purpose === "COUNTRY"
      ? `TowMech country confirmation code: ${otpCode}. Expires in 10 minutes.`
      : `Your TowMech OTP is: ${otpCode}. It expires in 10 minutes.`;

  await client.messages.create({ body: message, from, to });

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

      // Legacy compatibility
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
 * ✅ static OTP for selected test numbers
 */
async function generateAndSaveOtp(user, { minutes = 10 } = {}) {
  const useStatic = isStaticOtpTestPhone(user?.phone);
  const otpCode = useStatic ? STATIC_TEST_OTP : crypto.randomInt(100000, 999999).toString();

  user.otpCode = otpCode;
  user.otpExpiresAt = new Date(Date.now() + minutes * 60 * 1000);
  await user.save();

  return otpCode;
}

/**
 * ✅ Only providers get single-device session enforcement
 */
function isProviderRole(role) {
  return role === USER_ROLES.TOW_TRUCK || role === USER_ROLES.MECHANIC;
}

/**
 * ✅ =========================================
 * ✅ COUNTRY OTP (PERSISTED IN MONGO) ✅
 * ✅ =========================================
 * Fixes Render restarts / multi-instance issues (no more in-memory Map loss).
 *
 * Stored by "key" (COUNTRY::phoneCandidate)
 * TTL auto-removes expired docs via expiresAt index.
 */
const COUNTRY_OTP_TTL_MINUTES = 10;

const CountryOtpSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true, unique: true }, // e.g. "ZA::+2776..."
    countryCode: { type: String, required: true, index: true },
    phoneNormalized: { type: String, required: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

// TTL index (Mongo will delete after expiresAt passes)
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
 * ✅ =========================================
 * ✅ FIX: CHECK IF PHONE EXISTS (PUBLIC) ✅
 * ✅ =========================================
 *
 * ✅ PARALLEL LOGIC:
 * - A phone can exist in another country; we should only block duplicates WITHIN SAME COUNTRY.
 * - Return existsInThisCountry + existsAnywhere
 */
router.post("/check-phone", async (req, res) => {
  try {
    const { phone, countryCode } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({ message: "phone is required", exists: false });
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
    return res.status(500).json({ message: "Check phone failed", error: err.message, exists: false });
  }
});

/**
 * ✅ (Optional) Backward compatibility:
 * Keep old endpoint name if any older apps call it.
 * POST /api/auth/phone-exists
 */
router.post("/phone-exists", async (req, res) => {
  try {
    const { phone, countryCode } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({ message: "phone is required", exists: false });
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
    return res.status(500).json({ message: "Phone check failed", error: err.message, exists: false });
  }
});

/**
 * ✅ Register user
 * POST /api/auth/register
 *
 * ✅ PARALLEL LOGIC:
 * - uniqueness must be enforced PER COUNTRY (countryCode + phone/email)
 * - towTruckTypes/mechanicCategories must be read from PricingConfig PER COUNTRY
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
      return res.status(400).json({ message: "Invalid role provided" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);
    const normalizedPhone = normalizePhone(phone);

    // ✅ Skip strict validation for SuperAdmin/Admin
    if (role === USER_ROLES.SUPER_ADMIN || role === USER_ROLES.ADMIN) {
      // ✅ Admins should still be country-scoped for dashboards
      const emailClean = (email || "").trim().toLowerCase();

      const existing = await User.findOne({
        countryCode: requestCountryCode,
        email: emailClean,
      });

      if (existing) return res.status(409).json({ message: "User already exists" });

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
        message: "User registered successfully ✅",
        user: { id: user._id, name: user.name, email: user.email, role: user.role },
      });
    }

    if (!firstName || !lastName || !normalizedPhone || !email || !password || !birthday) {
      return res.status(400).json({
        message: "firstName, lastName, phone, email, password, birthday are required",
      });
    }

    // ✅ NOTE: You requested "nationalityType abandoned" on customer,
    // but backend currently requires it for ALL roles.
    // We keep logic intact here to avoid breaking existing calls.
    if (!nationalityType || !["SouthAfrican", "ForeignNational"].includes(nationalityType)) {
      return res.status(400).json({
        message: "nationalityType must be SouthAfrican or ForeignNational",
      });
    }

    if (nationalityType === "SouthAfrican") {
      if (!saIdNumber)
        return res.status(400).json({ message: "saIdNumber is required for SouthAfrican" });
      if (!isValidSouthAfricanID(saIdNumber))
        return res.status(400).json({ message: "Invalid South African ID number" });
    }

    if (nationalityType === "ForeignNational") {
      if (!passportNumber || !country) {
        return res.status(400).json({
          message: "passportNumber and country are required for ForeignNational",
        });
      }
      if (!isValidPassport(passportNumber)) {
        return res.status(400).json({
          message: "passportNumber must be 8 to 11 alphanumeric characters",
        });
      }
    }

    const { allowedTowTruckTypes, allowedMechanicCategories } =
      await getAllowedProviderTypesFromPricingConfig(requestCountryCode);

    let normalizedTowTypes = [];
    if (role === USER_ROLES.TOW_TRUCK) {
      normalizedTowTypes = normalizeTowTruckTypes(towTruckTypes);

      if (!normalizedTowTypes.length) {
        return res.status(400).json({
          message: "TowTruck providers must select at least 1 towTruckType",
        });
      }

      const invalid = normalizedTowTypes.filter((t) => !allowedTowTruckTypes.includes(t));
      if (invalid.length > 0) {
        return res.status(400).json({
          message: `Invalid towTruckTypes: ${invalid.join(", ")}`,
          allowed: allowedTowTruckTypes,
        });
      }
    }

    let normalizedMechCats = [];
    if (role === USER_ROLES.MECHANIC) {
      normalizedMechCats = normalizeMechanicCategories(mechanicCategories);

      if (!normalizedMechCats.length) {
        return res.status(400).json({
          message: "Mechanics must select at least 1 mechanic category",
        });
      }

      const invalid = normalizedMechCats.filter((c) => !allowedMechanicCategories.includes(c));
      if (invalid.length > 0) {
        return res.status(400).json({
          message: `Invalid mechanicCategories: ${invalid.join(", ")}`,
          allowed: allowedMechanicCategories,
        });
      }
    }

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    const emailClean = String(email).trim().toLowerCase();

    // ✅ PARALLEL: enforce email uniqueness per country
    const existingEmail = await User.findOne({
      countryCode: requestCountryCode,
      email: emailClean,
    });
    if (existingEmail) return res.status(409).json({ message: "Email already registered" });

    // ✅ PARALLEL: enforce phone uniqueness per country
    const existingPhone = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });
    if (existingPhone) return res.status(409).json({ message: "Phone number already registered" });

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
      nationalityType,
      saIdNumber: nationalityType === "SouthAfrican" ? saIdNumber : null,
      passportNumber: nationalityType === "ForeignNational" ? passportNumber : null,
      country: nationalityType === "ForeignNational" ? country : null,
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
      message: "User registered successfully ✅",
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("❌ REGISTER ERROR:", err.message);
    return res.status(500).json({ message: "Registration failed", error: err.message });
  }
});

/**
 * ✅ Login user (PHONE + PASSWORD) → ALWAYS OTP
 * POST /api/auth/login
 *
 * ✅ PARALLEL LOGIC:
 * - login must resolve the user within the selected countryCode
 * - prevents cross-country phone collisions returning wrong tenant user
 */
router.post("/login", async (req, res) => {
  try {
    console.log("✅ LOGIN ROUTE HIT ✅", req.body);

    const { phone, password } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !password) {
      return res.status(400).json({ message: "phone and password are required" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    // ✅ Prefer tenant match first
    let user = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });

    // ✅ fallback to legacy user without countryCode (old data), but DO NOT cross into other country
    if (!user) {
      user = await User.findOne({
        $and: [{ phone: { $in: phoneCandidates } }, { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] }],
      });
    }

    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    // ✅ If user has no countryCode yet, bind it now (one-time migration)
    if (!user.countryCode) {
      user.countryCode = requestCountryCode;
      await user.save();
    }

    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";
    if (debugEnabled) console.log(`🟧 OTP_DEBUG (LOGIN) → userPhone=${user.phone} | otp=${otpCode}`);

    const userDialingCode = await getDialingCodeForCountry(user.countryCode || requestCountryCode);

    try {
      await sendOtpSms(user.phone, otpCode, "OTP", userDialingCode);
    } catch (smsErr) {
      console.error("❌ SMS OTP SEND FAILED:", smsErr.message);
    }

    return res.status(200).json({
      message: "OTP sent via SMS ✅",
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
      isStaticOtpAccount: isStaticOtpTestPhone(user.phone),
      countryCode: user.countryCode || requestCountryCode,
    });
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err.message);
    return res.status(500).json({ message: "Login failed", error: err.message });
  }
});

/**
 * ✅ VERIFY OTP (PHONE + OTP) → returns token
 * POST /api/auth/verify-otp
 *
 * ✅ PARALLEL LOGIC:
 * - verify otp must match the same tenant countryCode
 */
router.post("/verify-otp", async (req, res) => {
  try {
    console.log("✅ VERIFY OTP HIT ✅", req.body);

    const { phone, otp } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !otp) {
      return res.status(400).json({ message: "phone and otp are required" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    // ✅ Prefer tenant match first
    let user = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });

    // ✅ fallback to legacy user without countryCode (old data)
    if (!user) {
      user = await User.findOne({
        $and: [{ phone: { $in: phoneCandidates } }, { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] }],
      });
    }

    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.otpCode || user.otpCode !== otp) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(401).json({ message: "OTP expired" });
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

    // ✅ If user has no countryCode yet, bind it now (one-time migration)
    if (!user.countryCode) user.countryCode = requestCountryCode;

    await user.save();

    const token = generateToken(user._id, user.role, sessionId);

    return res.status(200).json({
      message: "OTP verified ✅",
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
    return res.status(500).json({ message: "OTP verification failed", error: err.message });
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
      return res.status(400).json({ message: "phone is required" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const otpCode = generateCountryOtpCode(normalizedPhone);
    const expiresAt = new Date(Date.now() + COUNTRY_OTP_TTL_MINUTES * 60 * 1000);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);
    const keys = phoneCandidates.map((cand) => buildCountryOtpKey(String(cand), requestCountryCode));

    // Upsert all candidate keys so verify can match any format
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
      await sendOtpSms(normalizedPhone, otpCode, "COUNTRY", smsDialingCode);
    } catch (smsErr) {
      console.error("❌ COUNTRY SMS SEND FAILED:", smsErr.message);
    }

    return res.status(200).json({
      message: "Country OTP sent via SMS ✅",
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
      isStaticOtpAccount: isStaticOtpTestPhone(normalizedPhone),
      countryCode: requestCountryCode,
      expiresInMinutes: COUNTRY_OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error("❌ COUNTRY SEND OTP ERROR:", err.message);
    return res.status(500).json({
      message: "Country OTP send failed",
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
      return res.status(400).json({ message: "phone and otp are required" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);
    const keys = phoneCandidates.map((cand) => buildCountryOtpKey(String(cand), requestCountryCode));

    const rec = await CountryOtp.findOne({ key: { $in: keys } }).select("otp expiresAt key");
    if (!rec) {
      return res.status(404).json({
        message: "No OTP request found for this phone. Please request OTP again.",
      });
    }

    if (!rec.expiresAt || rec.expiresAt < new Date()) {
      await CountryOtp.deleteMany({ key: { $in: keys } });
      return res.status(401).json({ message: "OTP expired" });
    }

    if (String(rec.otp) !== String(otp).trim()) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // ✅ success: delete all variants for this phone+country (clean)
    await CountryOtp.deleteMany({ key: { $in: keys } });

    return res.status(200).json({
      message: "Country confirmed ✅",
      countryCode: requestCountryCode,
    });
  } catch (err) {
    console.error("❌ COUNTRY VERIFY OTP ERROR:", err.message);
    return res.status(500).json({
      message: "Country OTP verification failed",
      error: err.message,
    });
  }
});

/**
 * ✅ Forgot Password → sends OTP via SMS
 * POST /api/auth/forgot-password
 *
 * ✅ PARALLEL LOGIC:
 * - target user must be resolved inside selected countryCode
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({ message: "phone is required" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    // ✅ Prefer tenant match first
    let user = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });

    // ✅ fallback to legacy user without countryCode (old data)
    if (!user) {
      user = await User.findOne({
        $and: [{ phone: { $in: phoneCandidates } }, { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] }],
      });
    }

    if (!user) {
      return res.status(200).json({ message: "If your phone exists, an SMS code has been sent ✅" });
    }

    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";
    if (debugEnabled) console.log(`🟧 OTP_DEBUG (FORGOT) → userPhone=${user.phone} | otp=${otpCode}`);

    const userDialingCode = await getDialingCodeForCountry(user.countryCode || requestCountryCode);

    try {
      await sendOtpSms(user.phone, otpCode, "RESET", userDialingCode);
    } catch (smsErr) {
      console.error("❌ RESET SMS SEND FAILED:", smsErr.message);
    }

    return res.status(200).json({
      message: "If your phone exists, an SMS code has been sent ✅",
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
      isStaticOtpAccount: isStaticOtpTestPhone(user.phone),
      countryCode: user.countryCode || requestCountryCode,
    });
  } catch (err) {
    console.error("❌ FORGOT PASSWORD ERROR:", err.message);
    return res.status(500).json({ message: "Forgot password failed", error: err.message });
  }
});

/**
 * ✅ Reset Password (PHONE + OTP + newPassword)
 * POST /api/auth/reset-password
 *
 * ✅ PARALLEL LOGIC:
 * - user must resolve inside selected countryCode
 */
router.post("/reset-password", async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !otp || !newPassword) {
      return res.status(400).json({ message: "phone, otp, newPassword are required" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    // ✅ Prefer tenant match first
    let user = await User.findOne({
      countryCode: requestCountryCode,
      phone: { $in: phoneCandidates },
    });

    // ✅ fallback to legacy user without countryCode (old data)
    if (!user) {
      user = await User.findOne({
        $and: [{ phone: { $in: phoneCandidates } }, { $or: [{ countryCode: { $exists: false } }, { countryCode: null }] }],
      });
    }

    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.otpCode || user.otpCode !== otp) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(401).json({ message: "OTP expired" });
    }

    user.password = newPassword;
    user.otpCode = null;
    user.otpExpiresAt = null;

    // ✅ If user has no countryCode yet, bind it now (one-time migration)
    if (!user.countryCode) user.countryCode = requestCountryCode;

    await user.save();

    return res.status(200).json({ message: "Password reset successful ✅" });
  } catch (err) {
    console.error("❌ RESET PASSWORD ERROR:", err.message);
    return res.status(500).json({ message: "Reset password failed", error: err.message });
  }
});

/**
 * ✅ Get logged-in user profile
 * GET /api/auth/me
 */
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "name firstName lastName email phone birthday nationalityType saIdNumber passportNumber country role providerProfile countryCode permissions createdAt updatedAt"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    const safe = typeof user.toSafeJSON === "function" ? user.toSafeJSON(user.role) : user;

    if (safe && safe.countryCode == null && safe.country) safe.countryCode = safe.country;
    if (safe && !safe.permissions) safe.permissions = {};

    return res.status(200).json({ user: safe });
  } catch (err) {
    return res.status(500).json({ message: "Could not fetch profile", error: err.message });
  }
});

/**
 * ✅ Update logged-in user profile (phone/email/password only)
 * PATCH /api/auth/me
 */
router.patch("/me", auth, async (req, res) => {
  try {
    const userId = req.user?._id;
    const { phone, email, password } = req.body || {};

    const updates = {};
    if (typeof phone === "string" && phone.trim()) updates.phone = normalizePhone(phone);
    if (typeof email === "string" && email.trim()) updates.email = email.trim().toLowerCase();
    if (typeof password === "string" && password.trim()) updates.password = password.trim();

    if (Object.keys(updates).length === 0) return res.status(400).json({ message: "Nothing to update" });

    // ✅ determine current tenant country for uniqueness checks
    const currentUser = await User.findById(userId).select("countryCode");
    if (!currentUser) return res.status(404).json({ message: "User not found" });

    const tenantCountryCode = String(currentUser.countryCode || resolveReqCountryCode(req))
      .trim()
      .toUpperCase();

    if (updates.email) {
      const existingEmail = await User.findOne({
        countryCode: tenantCountryCode,
        email: updates.email,
        _id: { $ne: userId },
      });
      if (existingEmail) return res.status(409).json({ message: "Email already registered" });
    }

    if (updates.phone) {
      const dialingCode = await getDialingCodeForCountry(tenantCountryCode);
      const candidates = buildPhoneCandidates(updates.phone, dialingCode);

      const existingPhone = await User.findOne({
        countryCode: tenantCountryCode,
        phone: { $in: candidates },
        _id: { $ne: userId },
      });
      if (existingPhone) return res.status(409).json({ message: "Phone number already registered" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

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

    return res.status(200).json({ message: "Profile updated ✅", user: safe });
  } catch (err) {
    return res.status(500).json({ message: "Update failed", error: err.message });
  }
});

/**
 * ✅ Logout (clears FCM token + invalidates provider session)
 * POST /api/auth/logout
 */
router.post("/logout", auth, async (req, res) => {
  try {
    const userId = req.user?._id;

    const user = await User.findById(userId).select("role fcmToken providerProfile");
    if (!user) return res.status(404).json({ message: "User not found" });

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
      message: "Logged out ✅",
      cleared: {
        rootFcmToken: true,
        providerFcmToken: isProvider,
        providerSessionInvalidated: isProvider,
      },
    });
  } catch (err) {
    console.error("❌ LOGOUT ERROR:", err);
    return res.status(500).json({ message: "Logout failed", error: err.message });
  }
});

export default router;