// backend/src/routes/partnerAuth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User, { USER_ROLES } from "../models/User.js";
import Partner from "../models/Partner.js";
import { sendEmail } from "../utils/sendEmail.js"; // Assuming this utility exists

const router = express.Router();

const generateToken = (userId, role, partnerId, partnerRole) =>
  jwt.sign({ id: userId, role, partnerId, partnerRole }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

/**
 * ✅ Partner Login
 * Email + Password
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), partnerId: { $ne: null } });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials or access denied." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const partner = await Partner.findById(user.partnerId);
    if (!partner || partner.status !== "ACTIVE") {
      return res.status(403).json({ message: "Partner account is not active." });
    }

    // Generate Email OTP for login as requested
    const otp = crypto.randomInt(100000, 999999).toString();
    user.otpCode = otp;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendEmail({
      to: user.email,
      subject: "TowMech Partner Login OTP",
      text: `Your login OTP is: ${otp}. It expires in 10 minutes.`,
    });

    return res.status(200).json({ message: "OTP sent to your email.", email: user.email });
  } catch (err) {
    return res.status(500).json({ message: "Login failed", error: err.message });
  }
});

/**
 * ✅ Verify Partner OTP
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), otpCode: otp });

    if (!user || user.otpExpiresAt < new Date()) {
      return res.status(401).json({ message: "Invalid or expired OTP." });
    }

    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    const token = generateToken(user._id, user.role, user.partnerId, user.partnerRole);

    return res.status(200).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        partnerId: user.partnerId,
        partnerRole: user.partnerRole,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Verification failed", error: err.message });
  }
});

export default router;
