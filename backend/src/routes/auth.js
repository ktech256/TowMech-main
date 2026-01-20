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
 * ✅ Normalize phone for consistent login + uniqueness
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
 * ✅ build multiple phone candidates to match DB formats
 */
function buildPhoneCandidates(phone) {
  const p = normalizePhone(phone);
  const candidates = new Set();
  if (!p) return [];

  candidates.add(p);

  if (p.startsWith("+")) candidates.add(p.slice(1));

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
 * ✅ Send OTP via SMS (Twilio)
 */
async function sendOtpSms(phone, otpCode, purpose = "OTP") {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  const safePhone = normalizePhone(phone);

  if (!sid || !token || !from) {
    console.log("⚠️ TWILIO NOT CONFIGURED → SMS NOT SENT");
    console.log(
      `📲 ${purpose} SHOULD HAVE BEEN SENT TO:`,
      safePhone,
      "| OTP:",
      otpCode
    );
    return { ok: false, provider: "none" };
  }

  const client = twilio(sid, token);

  const message =
    purpose === "RESET"
      ? `TowMech password reset code: ${otpCode}. Expires in 10 minutes.`
      : `Your TowMech OTP is: ${otpCode}. It expires in 10 minutes.`;

  await client.messages.create({
    body: message,
    from,
    to: safePhone,
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
 */
async function generateAndSaveOtp(user, { minutes = 10 } = {}) {
  const otpCode = crypto.randomInt(100000, 999999).toString();
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

    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(409).json({ message: "Email already registered" });

    const existingPhone = await User.findOne({ phone: normalizedPhone });
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

    const phoneCandidates = buildPhoneCandidates(normalizedPhone);

    const user = await User.findOne({ phone: { $in: phoneCandidates } });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    console.log("✅ OTP GENERATED FOR:", user.phone, "| OTP:", otpCode);

    try {
      await sendOtpSms(user.phone, otpCode, "OTP");
    } catch (smsErr) {
      console.error("❌ SMS OTP SEND FAILED:", smsErr.message);
    }

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";

    return res.status(200).json({
      message: "OTP sent via SMS ✅",
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
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

    const phoneCandidates = buildPhoneCandidates(normalizedPhone);

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
      user: typeof user.toSafeJSON === "function" ? user.toSafeJSON(user.role) : undefined,
    });
  } catch (err) {
    console.error("❌ VERIFY OTP ERROR:", err.message);
    return res.status(500).json({ message: "OTP verification failed", error: err.message });
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

    const phoneCandidates = buildPhoneCandidates(normalizedPhone);

    const user = await User.findOne({ phone: { $in: phoneCandidates } });

    if (!user) {
      return res.status(200).json({ message: "If your phone exists, an SMS code has been sent ✅" });
    }

    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    try {
      await sendOtpSms(user.phone, otpCode, "RESET");
    } catch (smsErr) {
      console.error("❌ RESET SMS SEND FAILED:", smsErr.message);
    }

    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";

    return res.status(200).json({
      message: "If your phone exists, an SMS code has been sent ✅",
      otp: debugEnabled ? otpCode : undefined,
      requiresOtp: true,
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

    const phoneCandidates = buildPhoneCandidates(normalizedPhone);

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
 */
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "name firstName lastName email phone birthday nationalityType saIdNumber passportNumber country role providerProfile createdAt updatedAt"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({
      user: typeof user.toSafeJSON === "function" ? user.toSafeJSON(user.role) : user,
    });
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

    // ✅ Uniqueness checks
    if (updates.email) {
      const existingEmail = await User.findOne({
        email: updates.email,
        _id: { $ne: userId },
      });
      if (existingEmail) return res.status(409).json({ message: "Email already registered" });
    }

    if (updates.phone) {
      const existingPhone = await User.findOne({
        phone: updates.phone,
        _id: { $ne: userId },
      });
      if (existingPhone) return res.status(409).json({ message: "Phone number already registered" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Only update allowed fields
    if (updates.phone) user.phone = updates.phone;
    if (updates.email) user.email = updates.email;
    if (updates.password) user.password = updates.password; // hashed by pre-save

    await user.save();

    // ✅ Return fresh profile (same selection as GET /me)
    const fresh = await User.findById(userId).select(
      "name firstName lastName email phone birthday nationalityType saIdNumber passportNumber country role providerProfile createdAt updatedAt"
    );

    return res.status(200).json({
      message: "Profile updated ✅",
      user: typeof fresh.toSafeJSON === "function" ? fresh.toSafeJSON(fresh.role) : fresh,
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

    // Root token (if present in your DB)
    user.fcmToken = null;

    // Provider token + session invalidation
    if (isProvider) {
      if (!user.providerProfile) user.providerProfile = {};
      user.providerProfile.fcmToken = null;
      user.providerProfile.isOnline = false;

      // ✅ invalidates any existing provider JWT immediately
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