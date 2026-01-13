import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import auth from "../middleware/auth.js";
import User, { USER_ROLES, TOW_TRUCK_TYPES } from "../models/User.js";

// ✅ SMS provider (Twilio) — SAFE import for ESM/Render
import twilioPkg from "twilio";
const twilio = twilioPkg?.default || twilioPkg;

const router = express.Router();

// ✅ warn if missing (won’t crash boot, but highlights misconfig)
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing in environment variables");
}

// ✅ Helper: Generate JWT token
const generateToken = (userId, role) =>
  jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { expiresIn: "7d" });

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

  // IMPORTANT:
  // Do NOT force +27 here unless you're 100% sure all numbers are SA & stored with +27.
  // Your DB must match whatever normalization produces.
  return p;
}

/**
 * ✅ Send OTP via SMS (Twilio)
 */
async function sendOtpSms(phone, otpCode, purpose = "OTP") {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  const safePhone = normalizePhone(phone);

  // ✅ If SMS provider not configured → fallback to console (dev mode)
  if (!sid || !token || !from) {
    console.log("⚠️ TWILIO NOT CONFIGURED → SMS NOT SENT");
    console.log(`📲 ${purpose} SHOULD HAVE BEEN SENT TO:`, safePhone, "| OTP:", otpCode);
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

      if (lower === "flatbed") return "Flatbed";
      if (lower === "rollback") return "Rollback";
      if (lower === "towtruck") return "TowTruck";
      if (lower === "towtruck-xl" || lower === "towtruck xl") return "TowTruck-XL";
      if (lower === "towtruck-xxl" || lower === "towtruck xxl") return "TowTruck-XXL";
      if (lower === "recovery") return "Recovery";

      return x;
    });
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
 * ✅ Register user
 * POST /api/auth/register
 *
 * ✅ Email required during registration
 * ✅ Phone required too (because login uses phone)
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

    if (role === USER_ROLES.TOW_TRUCK) {
      const normalizedTypes = normalizeTowTruckTypes(towTruckTypes);

      if (!normalizedTypes.length) {
        return res.status(400).json({
          message: "TowTruck providers must select at least 1 towTruckType",
        });
      }

      const invalid = normalizedTypes.filter((t) => !TOW_TRUCK_TYPES.includes(t));
      if (invalid.length > 0) {
        return res.status(400).json({
          message: `Invalid towTruckTypes: ${invalid.join(", ")}`,
          allowed: TOW_TRUCK_TYPES,
        });
      }

      req.body.towTruckTypes = normalizedTypes;
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
              towTruckTypes: role === USER_ROLES.TOW_TRUCK ? req.body.towTruckTypes : [],
              isOnline: false,
              verificationStatus: "PENDING",
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
 * ✅ Login user (PHONE + PASSWORD)
 *
 * - Customers/Providers: OTP flow (returns {message, otp?})
 * - Admin/SuperAdmin: return token immediately (fast dashboard login)
 *
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

    const user = await User.findOne({ phone: normalizedPhone });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    // ✅ ✅ ✅ OPTION B: ADMIN BYPASS OTP (return token immediately)
    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role);
    if (isAdmin) {
      const token = generateToken(user._id, user.role);

      // Optional: clear any stale OTP fields
      user.otpCode = null;
      user.otpExpiresAt = null;
      await user.save();

      return res.status(200).json({
        message: "Login successful ✅",
        token,
        user: typeof user.toSafeJSON === "function" ? user.toSafeJSON(user.role) : undefined,
      });
    }

    // ✅ Non-admins keep OTP flow
    const otpCode = await generateAndSaveOtp(user, { minutes: 10 });

    console.log("✅ OTP GENERATED FOR PHONE:", normalizedPhone, "| OTP:", otpCode);

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
 * ✅ VERIFY OTP (PHONE + OTP)
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

    const user = await User.findOne({ phone: normalizedPhone });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.otpCode || user.otpCode !== otp) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(401).json({ message: "OTP expired" });
    }

    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    const token = generateToken(user._id, user.role);

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

    const user = await User.findOne({ phone: normalizedPhone });

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

    const user = await User.findOne({ phone: normalizedPhone });
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

export default router;