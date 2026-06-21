// backend/src/routes/partnerAuth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User, { USER_ROLES } from "../models/User.js";
import Partner from "../models/Partner.js";
import InsurancePartner from "../models/InsurancePartner.js";
import GlobalPortalSettings from "../models/GlobalPortalSettings.js";
import { sendEmail } from "../utils/sendEmail.js"; // Assuming this utility exists
import { logAuditEvent } from "../utils/auditLogger.js";
import { getOtpEmailTemplate } from "../services/PartnerEmailTemplateService.js";

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

    const [partner, insPartner] = await Promise.all([
       Partner.findById(user.partnerId),
       InsurancePartner.findById(user.partnerId)
    ]);
    const targetPartner = partner || insPartner;

    if (!targetPartner || targetPartner.status !== "ACTIVE" || targetPartner.isSuspended) {
      return res.status(403).json({ message: "Partner account is not active or suspended." });
    }

    const settings = await GlobalPortalSettings.findOne();
    if (settings) {
       if (settings.emergencyShutdownMode) {
          return res.status(503).json({ message: "Portals are currently under emergency maintenance." });
       }
       if (targetPartner.type === "FLEET" && !settings.fleetPortalEnabled) {
          return res.status(503).json({ message: "Fleet portal is currently disabled." });
       }
       if (targetPartner.type === "INSURANCE" && !settings.insurancePortalEnabled) {
          return res.status(503).json({ message: "Insurance portal is currently disabled." });
       }
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    user.otpCode = otp;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const html = getOtpEmailTemplate({ otp });

    await sendEmail({
      to: user.email,
      subject: "TowMech Partner Login OTP",
      html
    });

    await logAuditEvent(req, {
       action: "OTP_SENT",
       entityType: "PARTNER",
       entityId: user.partnerId,
       details: { email: user.email }
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

    await logAuditEvent(req, {
       action: "OTP_VERIFIED",
       entityType: "PARTNER",
       entityId: user.partnerId,
       details: { userId: user._id, email: user.email }
    });

    await logAuditEvent(req, {
       action: "PARTNER_LOGIN",
       entityType: "PARTNER",
       entityId: user.partnerId,
       details: { userId: user._id, role: user.role }
    });

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

/**
 * ✅ Activate Partner (Password Creation)
 */
router.post("/activate", async (req, res) => {
  try {
    const { token, password } = req.body;

    // Find partner with this token (search both collections)
    const [partner, insPartner] = await Promise.all([
      Partner.findOne({ activationToken: token, activationTokenExpiry: { $gt: new Date() } }),
      InsurancePartner.findOne({ activationToken: token, activationTokenExpiry: { $gt: new Date() } })
    ]);

    const targetPartner = partner || insPartner;

    if (!targetPartner) {
      return res.status(404).json({ message: "Invalid or expired activation token." });
    }

    // Create the initial Partner Admin User if it doesn't exist
    let user = await User.findOne({ email: targetPartner.contactEmail.toLowerCase() });

    if (user) {
       user.password = password;
       user.partnerId = targetPartner._id;
       user.role = USER_ROLES.PARTNER_ADMIN;
       await user.save();
    } else {
       user = await User.create({
         name: targetPartner.name,
         firstName: targetPartner.name,
         lastName: "Admin",
         email: targetPartner.contactEmail,
         password: password,
         phone: targetPartner.contactPhone,
         birthday: new Date(),
         nationalityType: "SouthAfrican",
         role: USER_ROLES.PARTNER_ADMIN,
         partnerId: targetPartner._id,
         partnerRole: "OWNER",
         countryCode: targetPartner.countryCode || (Array.isArray(targetPartner.countryCodes) ? targetPartner.countryCodes[0] : "ZA")
       });
    }

    targetPartner.status = "ACTIVE";
    targetPartner.activationToken = null;
    targetPartner.activationTokenExpiry = null;
    targetPartner.emailVerified = true;
    targetPartner.invitationStatus = "Activated";
    await targetPartner.save();

    await logAuditEvent(req, {
       action: "ACTIVATION_COMPLETED",
       entityType: "PARTNER",
       entityId: targetPartner._id,
       details: { userId: user._id, email: user.email }
    });

    await logAuditEvent(req, {
       action: "PASSWORD_CREATED",
       entityType: "PARTNER",
       entityId: targetPartner._id,
       details: { userId: user._id }
    });

    return res.status(200).json({ message: "Account activated successfully ✅", user: { email: user.email } });
  } catch (err) {
    return res.status(500).json({ message: "Activation failed", error: err.message });
  }
});

export default router;
