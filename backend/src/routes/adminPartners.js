// backend/src/routes/adminPartners.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import Partner from "../models/Partner.js";
import crypto from "crypto";
import { sendEmail } from "../utils/sendEmail.js";
import { sendPartnerInvitation } from "../services/PartnerInvitationService.js";

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

    const partner = await Partner.create({
      name,
      type,
      partnerCode,
      contactEmail,
      contactPhone,
      country,
      countryCode,
      workspace,
      createdBy: req.user._id,
    });

    // Invitation System: Send Email via Engine
    await sendPartnerInvitation(req, partner);

    return res.status(201).json({ message: "Partner created and invitation sent ✅", partner });
  } catch (err) {
    return res.status(500).json({ message: "Create failed", error: err.message });
  }
});

export default router;
