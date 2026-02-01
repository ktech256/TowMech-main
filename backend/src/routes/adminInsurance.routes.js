// backend/src/routes/adminInsurance.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import InsurancePartner from "../models/InsurancePartner.js";
import InsuranceCode from "../models/InsuranceCode.js";

import { generateCodesForPartner } from "../services/insurance/codeService.js";

const router = express.Router();

/**
 * GET /api/admin/insurance/partners?countryCode=ZA
 */
router.get(
  "/partners",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const countryCode = String(req.query.countryCode || "ZA").trim().toUpperCase();

      // If you want strict filtering per country:
      const partners = await InsurancePartner.find({
        countryCodes: { $in: [countryCode] },
      }).sort({ createdAt: -1 });

      return res.status(200).json({ partners });
    } catch (err) {
      return res.status(500).json({ message: "Failed to load partners", error: err.message });
    }
  }
);

/**
 * POST /api/admin/insurance/partners
 */
router.post(
  "/partners",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const {
        name,
        partnerCode,
        email,
        phone,
        logoUrl,
        description,
        countryCodes = ["ZA"],
        isActive = true,
      } = req.body || {};

      if (!name || !partnerCode) {
        return res.status(400).json({ message: "name and partnerCode are required" });
      }

      const codeUpper = String(partnerCode).trim().toUpperCase();

      const exists = await InsurancePartner.findOne({ partnerCode: codeUpper });
      if (exists) return res.status(409).json({ message: "partnerCode already exists" });

      const partner = await InsurancePartner.create({
        name: String(name).trim(),
        partnerCode: codeUpper,
        email: email ? String(email).trim().toLowerCase() : null,
        phone: phone ? String(phone).trim() : null,
        logoUrl: logoUrl ? String(logoUrl).trim() : null,
        description: description ? String(description).trim() : null,
        countryCodes: Array.isArray(countryCodes)
          ? countryCodes.map((c) => String(c).trim().toUpperCase())
          : ["ZA"],
        isActive: Boolean(isActive),
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });

      return res.status(201).json({ partner });
    } catch (err) {
      return res.status(500).json({ message: "Create failed", error: err.message });
    }
  }
);

/**
 * GET /api/admin/insurance/codes?partnerId=...&countryCode=ZA
 */
router.get(
  "/codes",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { partnerId, countryCode } = req.query || {};
      const filter = {};

      if (partnerId) filter.partner = partnerId;
      if (countryCode) filter.countryCode = String(countryCode).trim().toUpperCase();

      const codes = await InsuranceCode.find(filter)
        .populate("partner", "name partnerCode")
        .sort({ createdAt: -1 })
        .limit(500);

      return res.status(200).json({ codes });
    } catch (err) {
      return res.status(500).json({ message: "Failed to load codes", error: err.message });
    }
  }
);

/**
 * POST /api/admin/insurance/codes/generate
 * body: { partnerId, count }
 */
router.post(
  "/codes/generate",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { partnerId, count = 50, countryCode = "ZA" } = req.body || {};
      if (!partnerId) return res.status(400).json({ message: "partnerId is required" });

      const result = await generateCodesForPartner({
        partnerId,
        count: Number(count),
        length: 8,
        expiresInDays: 365,
        maxUses: 1,
        countryCode: String(countryCode).trim().toUpperCase(),
        createdBy: req.user?._id || null,
      });

      return res.status(201).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ message: "Generate failed", error: err.message });
    }
  }
);

export default router;