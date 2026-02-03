import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import auth from "../middleware/auth.js";
import User, {
  USER_ROLES,
  TOW_TRUCK_TYPES,
  MECHANIC_CATEGORIES,
} from "../models/User.js";

// ✅ NEW: PricingConfig source of truth for dashboard-controlled categories/types
import PricingConfig from "../models/PricingConfig.js";

// ✅ NEW: Country (to resolve dialing code)
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
    const c = await Country.findOne({ code: cc }).select(
      "dialingCode phoneRules code"
    );
    const fromDb =
      c?.dialingCode ||
      c?.phoneRules?.dialingCode ||
      c?.phoneRules?.countryDialingCode ||
      null;

    if (fromDb && typeof fromDb === "string" && fromDb.trim()) {
      const d = fromDb.trim();
      return d.startsWith("+") ? d : `+${d}`;
    }
  } catch (e) {
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
    if (
      /^\d{7,15}$/.test(digitsOnly) &&
      digitsOnly.startsWith(dialDigits)
    ) {
      candidates.add("+" + digitsOnly);
    }

    // local 0xxxxx => dial + rest
    if (/^0\d{6,14}$/.test(digitsOnly)) {
      candidates.add(`${dialingCode}${digitsOnly.slice(1)}`); // +2547...
      candidates.add(`${dialDigits}${digitsOnly.slice(1)}`); // 2547...
    }

    // short national digits => prefix dialing code
    if (
      /^\d{7,12}$/.test(digitsOnly) &&
      !digitsOnly.startsWith(dialDigits)
    ) {
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
 * - Only these 5 phone numbers will use the static OTP.
 * - Login input is 10 digits starting with 0 (example: 0711111111)
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
 * Supports:
 *  - 0XXXXXXXXX
 *  - 27XXXXXXXXX
 *  - +27XXXXXXXXX
 */
function toLocalZaPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return "";

  // Keep only digits plus optional leading +
  const clean = p.replace(/[^\d+]/g, "");

  if (/^0\d{9}$/.test(clean)) return clean;

  if (/^\+27\d{9}$/.test(clean)) return "0" + clean.slice(3);
  if (/^27\d{9}$/.test(clean)) return "0" + clean.slice(2);

  // Fallback: digits only (won't match unless it becomes 0XXXXXXXXX)
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
 */
async function sendOtpSms(phone, otpCode, purpose = "OTP", dialingCode = null) {
  // ✅ Static OTP numbers: do NOT send SMS (reviewers can just type 123456)
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
    console.log(
      `📲 ${purpose} SHOULD HAVE BEEN SENT TO:`,
      to,
      "| OTP:",
      otpCode
    );
    return { ok: false, provider: "none" };
  }

  // Guard: Twilio expects E.164 (+...)
  if (!to || !to.startsWith("+")) {
    console.error(
      "❌ SMS OTP SEND FAILED: Invalid 'To' Phone Number:",
      phone,
      "->",
      to
    );
    return {
      ok: false,
      provider: "twilio",
      error: "Invalid destination phone number",
    };
  }

  const client = twilio(sid, token);

  const message =
    purpose === "RESET"
      ? `TowMech password reset code: ${otpCode}. Expires in 10 minutes.`
      : purpose === "COUNTRY"
      ? `TowMech country confirmation code: ${otpCode}. Expires in 10 minutes.`
      : `Your TowMech OTP is: ${otpCode}. It expires in 10 minutes.`;

  await client.messages.create({
    body: message,
    from,
    to,
  });

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

      if (lower.includes("hook") && lower.includes("chain"))
        return "Hook & Chain";
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
      if (lower.includes("integrated") || lower.includes("wrecker"))
        return "Integrated / Wrecker";
      if (
        lower.includes("rotator") ||
        lower.includes("heavy-duty") ||
        lower === "recovery"
      )
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
 * ✅ NEW: Allowed types/categories should come from PricingConfig (dashboard)
 * Falls back to constants for safety.
 */
async function getAllowedProviderTypesFromPricingConfig() {
  let pricing = await PricingConfig.findOne();
  if (!pricing) pricing = await PricingConfig.create({});

  const allowedTowTruckTypes =
    Array.isArray(pricing.towTruckTypes) && pricing.towTruckTypes.length > 0
      ? pricing.towTruckTypes
      : TOW_TRUCK_TYPES;

  const allowedMechanicCategories =
    Array.isArray(pricing.mechanicCategories) && pricing.mechanicCategories.length > 0
      ? pricing.mechanicCategories
      : MECHANIC_CATEGORIES;

  return {
    pricing,
    allowedTowTruckTypes,
    allowedMechanicCategories,
  };
}

/**
 * ✅ Helper: Generate OTP + save
 * ✅ UPDATED: static OTP for selected test numbers
 */
async function generateAndSaveOtp(user, { minutes = 10 } = {}) {
  const useStatic = isStaticOtpTestPhone(user?.phone);
  const otpCode = useStatic
    ? STATIC_TEST_OTP
    : crypto.randomInt(100000, 999999).toString();

  user.otpCode = otpCode;
  user.otpExpiresAt = new Date(Date.now() + minutes * 60 * 1000);
  await user.save();

  return otpCode;
}

/**
 * ✅ Helper: Only providers get single-device session enforcement
 */
function isProviderRole(role) {
  return role === USER_ROLES.TOW_TRUCK || role === USER_ROLES.MECHANIC;
}

/**
 * ✅ =========================================
 * ✅ COUNTRY-ONLY OTP STORE (NO USER REQUIRED)
 * ✅ =========================================
 * This is used ONLY for the "Country Start Screen" flow.
 * It does NOT create a user and does NOT log anyone in.
 *
 * NOTE: This is in-memory (works well for staging / single instance).
 */
const COUNTRY_OTP_TTL_MINUTES = 10;
const countryOtpStore = new Map(); // key => { otp, expiresAt, countryCode, phoneNormalized }

function buildCountryOtpKey(phoneNormalized, countryCode) {
  return `${String(countryCode || "ZA").toUpperCase()}::${String(phoneNormalized || "").trim()}`;
}

function cleanupExpiredCountryOtps() {
  const now = Date.now();
  for (const [k, v] of countryOtpStore.entries()) {
    if (!v?.expiresAt || v.expiresAt.getTime() <= now) {
      countryOtpStore.delete(k);
    }
  }
}

function generateCountryOtpCode(phone) {
  // same static rule as login flow
  if (isStaticOtpTestPhone(phone)) return STATIC_TEST_OTP;
  return crypto.randomInt(100000, 999999).toString();
}

function findCountryOtpRecordByCandidates(phoneCandidates, countryCode) {
  for (const cand of phoneCandidates) {
    const key = buildCountryOtpKey(String(cand), countryCode);
    const rec = countryOtpStore.get(key);
    if (rec) return { key, rec };
  }
  return null;
}

/**
 * ✅ Register user
 * POST /api/auth/register
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
      mechanicCategories, // ✅ NEW
    } = req.body;

    if (!Object.values(USER_ROLES).includes(role)) {
      return res.status(400).json({ message: "Invalid role provided" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const normalizedPhone = normalizePhone(phone);

    // ✅ Skip strict validation for SuperAdmin/Admin
    if (role === USER_ROLES.SUPER_ADMIN || role === USER_ROLES.ADMIN) {
      const existing = await User.findOne({ email });
      if (existing) return res.status(409).json({ message: "User already exists" });

      const user = await User.create({
        name: `${firstName || "Admin"} ${lastName || ""}`.trim(),
        firstName: firstName || "Admin",
        lastName: lastName || "",
        phone: normalizedPhone || "",
        email,
        password,
        birthday: birthday || null,
        role,

        // ✅ ensure admin is scoped to request country unless set elsewhere
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

    if (!nationalityType || !["SouthAfrican", "ForeignNational"].includes(nationalityType)) {
      return res.status(400).json({
        message: "nationalityType must be SouthAfrican or ForeignNational",
      });
    }

    if (nationalityType === "SouthAfrican") {
      if (!saIdNumber) {
        return res.status(400).json({ message: "saIdNumber is required for SouthAfrican" });
      }
      if (!isValidSouthAfricanID(saIdNumber)) {
        return res.status(400).json({ message: "Invalid South African ID number" });
      }
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

    // ✅ Load allowed types/categories from PricingConfig (dashboard controlled)
    const { allowedTowTruckTypes, allowedMechanicCategories } =
      await getAllowedProviderTypesFromPricingConfig();

    // ✅ Tow truck onboarding validation
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

    // ✅ Mechanic onboarding validation
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

    // ✅ Uniqueness checks should consider normalized candidates (multi-country)
    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);

    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(409).json({ message: "Email already registered" });

    const existingPhone = await User.findOne({ phone: { $in: phoneCandidates } });
    if (existingPhone) return res.status(409).json({ message: "Phone number already registered" });

    const name = `${firstName.trim()} ${lastName.trim()}`;

    const user = await User.create({
      name,
      firstName,
      lastName,
      phone: normalizedPhone,
      email,
      password,
      birthday,

      // ✅ country scoping for parallel countries
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

    const user = await User.findOne({ phone: { $in: phoneCandidates } });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    console.log("✅ OTP GENERATED FOR:", user.phone, "| OTP:", otpCode);

    // use user's stored countryCode when sending sms formatting (safer)
    const userDialingCode = await getDialingCodeForCountry(user.countryCode || requestCountryCode);

    try {
      await sendOtpSms(user.phone, otpCode, "OTP", userDialingCode);
    } catch (smsErr) {
      console.error("❌ SMS OTP SEND FAILED:", smsErr.message);
    }

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";

    return res.status(200).json({
      message: "OTP sent via SMS ✅",
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
      // ✅ optional hint (safe): tells tester it is a static-OTP account
      isStaticOtpAccount: isStaticOtpTestPhone(user.phone),

      // ✅ helps dashboard/android set workspace immediately
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

    const user = await User.findOne({ phone: { $in: phoneCandidates } });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.otpCode || user.otpCode !== otp) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(401).json({ message: "OTP expired" });
    }

    // ✅ clear OTP
    user.otpCode = null;
    user.otpExpiresAt = null;

    // ✅ SINGLE DEVICE ENFORCEMENT: Only for providers (TowTruck/Mechanic)
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

    await user.save();

    const token = generateToken(user._id, user.role, sessionId);

    return res.status(200).json({
      message: "OTP verified ✅",
      token,

      // ✅ IMPORTANT: dashboard needs permissions + role + countryCode
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

      // ✅ helps dashboard/android set workspace immediately
      countryCode: user.countryCode || requestCountryCode,
    });
  } catch (err) {
    console.error("❌ VERIFY OTP ERROR:", err.message);
    return res.status(500).json({ message: "OTP verification failed", error: err.message });
  }
});

/**
 * ✅✅✅ COUNTRY OTP (NO TOKEN, NO USER) ✅
 * POST /api/auth/country/send-otp
 *
 * Body:
 *  - phone (required)
 *  - countryCode (optional, but recommended)
 *  - language (optional)
 */
router.post("/country/send-otp", async (req, res) => {
  try {
    cleanupExpiredCountryOtps();

    const { phone } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({ message: "phone is required" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const otpCode = generateCountryOtpCode(normalizedPhone);
    const expiresAt = new Date(Date.now() + COUNTRY_OTP_TTL_MINUTES * 60 * 1000);

    // store against multiple candidates so verify can match whatever format comes back
    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);
    for (const cand of phoneCandidates) {
      const key = buildCountryOtpKey(String(cand), requestCountryCode);
      countryOtpStore.set(key, {
        otp: otpCode,
        expiresAt,
        countryCode: requestCountryCode,
        phoneNormalized: normalizedPhone,
      });
    }

    // send SMS (or skip if static)
    const smsDialingCode = dialingCode || DIALING_CODE_FALLBACK[requestCountryCode] || null;
    try {
      await sendOtpSms(normalizedPhone, otpCode, "COUNTRY", smsDialingCode);
    } catch (smsErr) {
      console.error("❌ COUNTRY SMS SEND FAILED:", smsErr.message);
      // still return a friendly message; app will show backend error if you want by throwing
    }

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";

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
 * ✅✅✅ COUNTRY OTP VERIFY (NO TOKEN, NO USER) ✅
 * POST /api/auth/country/verify-otp
 *
 * Body:
 *  - phone (required)
 *  - otp (required)
 *  - countryCode (optional but recommended)
 */
router.post("/country/verify-otp", async (req, res) => {
  try {
    cleanupExpiredCountryOtps();

    const { phone, otp } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !otp) {
      return res.status(400).json({ message: "phone and otp are required" });
    }

    const requestCountryCode = resolveReqCountryCode(req);
    const dialingCode = await getDialingCodeForCountry(requestCountryCode);

    const phoneCandidates = buildPhoneCandidates(normalizedPhone, dialingCode);
    const hit = findCountryOtpRecordByCandidates(phoneCandidates, requestCountryCode);

    if (!hit || !hit.rec) {
      return res.status(404).json({
        message: "No OTP request found for this phone. Please request OTP again.",
      });
    }

    const { key, rec } = hit;

    if (!rec.expiresAt || rec.expiresAt < new Date()) {
      countryOtpStore.delete(key);
      return res.status(401).json({ message: "OTP expired" });
    }

    if (String(rec.otp) !== String(otp).trim()) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    // ✅ success: delete all variants for this phone+country (clean)
    for (const cand of phoneCandidates) {
      countryOtpStore.delete(buildCountryOtpKey(String(cand), requestCountryCode));
    }

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

    const user = await User.findOne({ phone: { $in: phoneCandidates } });

    if (!user) {
      return res.status(200).json({ message: "If your phone exists, an SMS code has been sent ✅" });
    }

    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    const userDialingCode = await getDialingCodeForCountry(user.countryCode || requestCountryCode);

    try {
      await sendOtpSms(user.phone, otpCode, "RESET", userDialingCode);
    } catch (smsErr) {
      console.error("❌ RESET SMS SEND FAILED:", smsErr.message);
    }

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";

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

    const user = await User.findOne({ phone: { $in: phoneCandidates } });
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
 *
 * ✅ FIX: include permissions + countryCode in select so dashboard can filter nav correctly.
 */
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "name firstName lastName email phone birthday nationalityType saIdNumber passportNumber country role providerProfile countryCode permissions createdAt updatedAt"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    const safe = typeof user.toSafeJSON === "function" ? user.toSafeJSON(user.role) : user;

    // ✅ compatibility: some older code uses `country` instead of `countryCode`
    if (safe && safe.countryCode == null && safe.country) {
      safe.countryCode = safe.country;
    }

    // ✅ ensure permissions always exists (dashboard expects object)
    if (safe && !safe.permissions) safe.permissions = {};

    return res.status(200).json({ user: safe });
  } catch (err) {
    return res.status(500).json({
      message: "Could not fetch profile",
      error: err.message,
    });
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

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    // ✅ Uniqueness checks (multi-country candidate aware)
    if (updates.email) {
      const existingEmail = await User.findOne({
        email: updates.email,
        _id: { $ne: userId },
      });
      if (existingEmail) return res.status(409).json({ message: "Email already registered" });
    }

    if (updates.phone) {
      const currentUser = await User.findById(userId).select("countryCode");
      const dialingCode = await getDialingCodeForCountry(currentUser?.countryCode || "ZA");
      const candidates = buildPhoneCandidates(updates.phone, dialingCode);

      const existingPhone = await User.findOne({
        phone: { $in: candidates },
        _id: { $ne: userId },
      });
      if (existingPhone) return res.status(409).json({ message: "Phone number already registered" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Only update allowed fields
    if (updates.phone) user.phone = updates.phone; // User model will normalize for storage
    if (updates.email) user.email = updates.email;
    if (updates.password) user.password = updates.password; // hashed by pre-save

    await user.save();

    const fresh = await User.findById(userId).select(
      "name firstName lastName email phone birthday nationalityType saIdNumber passportNumber country role providerProfile countryCode permissions createdAt updatedAt"
    );

    const safe = typeof fresh.toSafeJSON === "function" ? fresh.toSafeJSON(fresh.role) : fresh;
    if (safe && !safe.permissions) safe.permissions = {};
    if (safe && safe.countryCode == null && safe.country) safe.countryCode = safe.country;

    return res.status(200).json({
      message: "Profile updated ✅",
      user: safe,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Update failed",
      error: err.message,
    });
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
    return res.status(500).json({
      message: "Logout failed",
      error: err.message,
    });
  }
});

export default router;