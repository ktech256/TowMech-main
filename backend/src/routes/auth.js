import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";

const router = express.Router();

// ✅ FORCE LOG TO CONFIRM THIS FILE LOADS (RENDER LOGS)
console.log("✅ auth.js loaded ✅");

// ✅ Helper: Generate JWT token
const generateToken = (userId, role) =>
  jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { expiresIn: "7d" });

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
    } = req.body;

    // ✅ ROLE VALIDATION FIRST
    if (!Object.values(USER_ROLES).includes(role)) {
      console.log("🟥 REGISTER FAIL: Invalid role", role);
      return res.status(400).json({ message: "Invalid role provided" });
    }

    // ✅ ✅ IMPORTANT: Skip strict validation for SuperAdmin/Admin
    if (role === USER_ROLES.SUPER_ADMIN || role === USER_ROLES.ADMIN) {
      console.log("🟨 REGISTER: Admin/SuperAdmin detected → skipping strict validation");

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ message: "User already exists" });
      }

      const user = await User.create({
        name: `${firstName || "Admin"} ${lastName || ""}`.trim(),
        firstName: firstName || "Admin",
        lastName: lastName || "",
        phone: phone || "",
        email,
        password,
        birthday: birthday || null,
        role,
      });

      return res.status(201).json({
        message: "User registered successfully ✅",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    }

    // ✅ BASIC REQUIRED FIELDS (STRICT)
    if (!firstName || !lastName || !phone || !email || !password || !birthday) {
      console.log("🟥 REGISTER FAIL: Missing required fields");
      return res.status(400).json({
        message: "firstName, lastName, phone, email, password, birthday are required",
      });
    }

    // ✅ NATIONALITY VALIDATION
    if (!nationalityType || !["SouthAfrican", "ForeignNational"].includes(nationalityType)) {
      return res.status(400).json({
        message: "nationalityType must be SouthAfrican or ForeignNational",
      });
    }

    // ✅ South African rules
    if (nationalityType === "SouthAfrican") {
      if (!saIdNumber) {
        return res.status(400).json({
          message: "saIdNumber is required for SouthAfrican",
        });
      }

      if (!isValidSouthAfricanID(saIdNumber)) {
        return res.status(400).json({
          message: "Invalid South African ID number",
        });
      }
    }

    // ✅ Foreign National rules
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

    // ✅ TowTruck must select towTruckTypes
    if (role === USER_ROLES.TOW_TRUCK) {
      if (!towTruckTypes || !Array.isArray(towTruckTypes) || towTruckTypes.length === 0) {
        return res.status(400).json({
          message: "TowTruck providers must select at least 1 towTruckType",
        });
      }
    }

    const existing = await User.findOne({ email });
    if (existing) {
      console.log("🟨 REGISTER FAIL: user already exists");
      return res.status(409).json({ message: "User already exists" });
    }

    const name = `${firstName.trim()} ${lastName.trim()}`;

    const user = await User.create({
      name,
      firstName,
      lastName,
      phone,
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
              towTruckTypes: role === USER_ROLES.TOW_TRUCK ? towTruckTypes : [],
              isOnline: false,
              verificationStatus: "PENDING",
            }
          : undefined,
    });

    console.log("✅ REGISTER SUCCESS:", user.email, user.role);

    return res.status(201).json({
      message: "User registered successfully ✅",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ REGISTER ERROR:", err.message);
    return res.status(500).json({
      message: "Registration failed",
      error: err.message,
    });
  }
});

/**
 * ✅ Login user → generates OTP
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    console.log("✅ LOGIN ROUTE HIT ✅", req.body);

    const { email, password } = req.body;

    console.log("🟦 LOGIN HIT:", email);
    console.log("🟦 ENABLE_OTP_DEBUG:", process.env.ENABLE_OTP_DEBUG);

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      console.log("🟥 LOGIN FAIL: user not found");
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      console.log("🟥 LOGIN FAIL: wrong password");
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const otpCode = crypto.randomInt(100000, 999999).toString();
    user.otpCode = otpCode;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    // ✅ ALWAYS LOG OTP to Render Logs (BEST FOR TESTING)
    console.log("✅ OTP GENERATED FOR:", email, "| OTP:", otpCode);

    // ✅ Return OTP only if debug enabled
    const debugEnabled = String(process.env.ENABLE_OTP_DEBUG).toLowerCase() === "true";

    return res.status(200).json({
      message: "OTP generated ✅",
      otp: debugEnabled ? otpCode : undefined,
    });
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err.message);
    return res.status(500).json({
      message: "Login failed",
      error: err.message,
    });
  }
});

/**
 * ✅ Verify OTP → returns token
 * POST /api/auth/verify-otp
 */
router.post("/verify-otp", async (req, res) => {
  try {
    console.log("✅ VERIFY OTP HIT ✅", req.body.email);

    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const user = await User.findOne({ email });

    if (!user || !user.otpCode) {
      return res.status(400).json({
        message: "OTP not requested or user not found",
      });
    }

    const isExpired = user.otpExpiresAt && user.otpExpiresAt < new Date();

    if (isExpired || user.otpCode !== otp) {
      return res.status(401).json({ message: "Invalid or expired OTP" });
    }

    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      message: "OTP verified ✅",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ OTP VERIFY ERROR:", err.message);
    return res.status(500).json({
      message: "OTP verification failed",
      error: err.message,
    });
  }
});

/**
 * ✅ Get logged-in user profile
 * GET /api/auth/me
 */
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -otpCode -otpExpiresAt");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      user: {
        ...user.toObject(),
        providerProfile: user.providerProfile || null,
      },
    });
  } catch (err) {
    console.error("❌ ME ERROR:", err.message);
    return res.status(500).json({
      message: "Could not fetch profile",
      error: err.message,
    });
  }
});

export default router;