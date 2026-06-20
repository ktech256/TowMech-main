// backend/src/routes/adminPartners.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import Partner from "../models/Partner.js";
import crypto from "crypto";
import { sendEmail } from "../utils/sendEmail.js";

const router = express.Router();

/**
 * Admin-only check
 */
const requireAdmin = async (req, res, next) => {
  if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
};

/**
 * ✅ List Partners
 */
router.get("/", auth, requireAdmin, async (req, res) => {
  try {
    const { type, countryCode } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (countryCode) filter.countryCode = countryCode;

    const partners = await Partner.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ partners });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch partners", error: err.message });
  }
});

/**
 * ✅ Create Partner (Fleet / Mechanic)
 */
router.post("/", auth, requireAdmin, async (req, res) => {
  try {
    const { name, type, partnerCode, contactEmail, contactPhone, country, countryCode, workspace } = req.body;

    if (!name || !type || !partnerCode || !contactEmail) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const exists = await Partner.findOne({ $or: [{ partnerCode }, { contactEmail }] });
    if (exists) {
      return res.status(409).json({ message: "Partner code or email already exists" });
    }

    const activationToken = crypto.randomBytes(32).toString("hex");

    const partner = await Partner.create({
      name,
      type,
      partnerCode,
      contactEmail,
      contactPhone,
      country,
      countryCode,
      workspace,
      activationToken,
      createdBy: req.user._id,
    });

    // Invitation System: Send Email
    const activationLink = `https://fleet.towmech.com/activate?token=${activationToken}`;
    await sendEmail({
      to: contactEmail,
      subject: "Invitation to Join TowMech Partner Ecosystem",
      text: `Hello ${name},\n\nYou have been invited as a ${type} partner. Your Partner Code is: ${partnerCode}.\n\nPlease activate your account here: ${activationLink}`,
    });

    return res.status(201).json({ message: "Partner created and invitation sent ✅", partner });
  } catch (err) {
    return res.status(500).json({ message: "Create failed", error: err.message });
  }
});

/**
 * ✅ Activate Partner Account
 * (Accessed from fleet.towmech.com/activate)
 */
router.post("/activate", async (req, res) => {
  try {
    const { token, password } = req.body;
    const partner = await Partner.findOne({ activationToken: token });

    if (!partner) {
      return res.status(404).json({ message: "Invalid or expired activation token." });
    }

    // Create the initial Partner Admin User
    const user = await User.create({
      name: partner.name,
      firstName: partner.name,
      lastName: "Admin",
      email: partner.contactEmail,
      password: password, // Will be hashed by pre-save hook
      phone: partner.contactPhone,
      birthday: new Date(),
      nationalityType: "SouthAfrican", // Default fallback
      role: USER_ROLES.PARTNER_ADMIN,
      partnerId: partner._id,
      partnerRole: "OWNER",
      countryCode: partner.countryCode,
    });

    partner.status = "ACTIVE";
    partner.activationToken = null;
    await partner.save();

    return res.status(200).json({ message: "Account activated successfully ✅", user: { email: user.email } });
  } catch (err) {
    return res.status(500).json({ message: "Activation failed", error: err.message });
  }
});

export default router;
