// backend/src/routes/insurance.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";

import InsurancePartner from "../models/InsurancePartner.js";
import InsuranceCode from "../models/InsuranceCode.js";

import CountryServiceConfig from "../models/CountryServiceConfig.js";

import {
  generateCodesForPartner,
  validateInsuranceCode,
  markInsuranceCodeUsed,
  disableInsuranceCode,
} from "../services/insurance/codeService.js";

const router = express.Router();

function resolveReqCountryCode(req) {
  return String(
    req.countryCode ||
      req.headers["x-country-code"] ||
      req.query?.countryCode ||
      req.query?.country ||
      req.body?.countryCode ||
      "ZA"
  )
    .trim()
    .toUpperCase();
}

async function insuranceEnabledOr403(req, res, next) {
  try {
    const cc = resolveReqCountryCode(req);
    const cfg = await CountryServiceConfig.findOne({ countryCode: cc })
      .select("services.insuranceEnabled")
      .lean();

    const enabled =
      typeof cfg?.services?.insuranceEnabled === "boolean" ? cfg.services.insuranceEnabled : false;

    if (!enabled) {
      return res.status(403).json({
        message: "Insurance service is disabled in this country.",
        countryCode: cc,
        code: "SERVICE_DISABLED",
      });
    }

    req.countryCode = cc;
    return next();
  } catch (err) {
    return res.status(500).json({ message: "Service check failed", error: err.message });
  }
}

/**
 * Helper: Only Admin/SuperAdmin
 */
async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const user = await User.findById(userId).select("role");
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    req.adminUser = user;
    next();
  } catch (err) {
    return res.status(500).json({ message: "Auth error", error: err.message });
  }
}

/**
 * ============================
 * PUBLIC ROUTES (APP)
 * ============================
 */

/**
 * GET /api/insurance/partners
 * Returns active insurance partners for dropdown
 */
router.get("/partners", insuranceEnabledOr403, async (req, res) => {
  try {
    const countryCode = resolveReqCountryCode(req);

    const partners = await InsurancePartner.find({
      isActive: true,
      countryCodes: { $in: [countryCode] },
    })
      .select("name partnerCode logoUrl description countryCodes isActive createdAt")
      .sort({ name: 1 });

    return res.status(200).json({ partners, countryCode });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load partners", error: err.message });
  }
});

/**
 * POST /api/insurance/validate-code
 * Body: { partnerId, code, phone?, email? }
 */
router.post("/validate-code", insuranceEnabledOr403, async (req, res) => {
  try {
    const countryCode = resolveReqCountryCode(req);
    const partnerId = req.body?.partnerId ? String(req.body.partnerId).trim() : null;
    const code = String(req.body?.code || "").trim();
    const phone = req.body?.phone ? String(req.body.phone).trim() : null;
    const email = req.body?.email ? String(req.body.email).trim() : null;

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "Insurance code is required",
        code: "INSURANCE_CODE_REQUIRED",
        countryCode,
      });
    }

    const result = await validateInsuranceCode({
      partnerId,
      code,
      phone,
      email,
      countryCode,
    });

    if (!result.ok) return res.status(400).json(result);

    return res.status(200).json({ ...result, countryCode });
  } catch (err) {
    return res.status(500).json({ message: "Validation failed", error: err.message });
  }
});

/**
 * ============================
 * ADMIN ROUTES (DASHBOARD)
 * (Admins can manage even if insurance is OFF for a country)
 * ============================
 */

router.get("/admin/partners", auth, requireAdmin, async (req, res) => {
  try {
    const partners = await InsurancePartner.find()
      .select("name partnerCode email phone logoUrl description countryCodes isActive createdAt updatedAt")
      .sort({ createdAt: -1 });

    return res.status(200).json({ partners });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load partners", error: err.message });
  }
});

router.post("/admin/partners", auth, requireAdmin, async (req, res) => {
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

    return res.status(201).json({ message: "Insurance partner created ✅", partner });
  } catch (err) {
    return res.status(500).json({ message: "Create failed", error: err.message });
  }
});

router.patch("/admin/partners/:id", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const partner = await InsurancePartner.findById(id);
    if (!partner) return res.status(404).json({ message: "Partner not found" });

    const { name, email, phone, logoUrl, description, countryCodes, isActive } = req.body || {};

    if (typeof name === "string" && name.trim()) partner.name = name.trim();
    if (typeof email === "string") partner.email = email.trim().toLowerCase();
    if (typeof phone === "string") partner.phone = phone.trim();
    if (typeof logoUrl === "string") partner.logoUrl = logoUrl.trim();
    if (typeof description === "string") partner.description = description.trim();
    if (Array.isArray(countryCodes)) {
      partner.countryCodes = countryCodes.map((c) => String(c).trim().toUpperCase());
    }
    if (typeof isActive === "boolean") partner.isActive = isActive;

    partner.updatedBy = req.user?._id || null;

    await partner.save();

    return res.status(200).json({ message: "Partner updated ✅", partner });
  } catch (err) {
    return res.status(500).json({ message: "Update failed", error: err.message });
  }
});

router.post("/admin/partners/:partnerId/codes/generate", auth, requireAdmin, async (req, res) => {
  try {
    const { partnerId } = req.params;

    const {
      count = 50,
      length = 8,
      expiresInDays = 365,
      maxUses = 1,
      countryCode = "ZA",
    } = req.body || {};

    const result = await generateCodesForPartner({
      partnerId,
      count: Number(count),
      length: Number(length),
      expiresInDays: Number(expiresInDays),
      maxUses: Number(maxUses),
      countryCode: String(countryCode).trim().toUpperCase(),
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      message: "Codes generated ✅",
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ message: "Generate failed", error: err.message });
  }
});

router.get("/admin/codes", auth, requireAdmin, async (req, res) => {
  try {
    const { partnerId, countryCode, isActive, used } = req.query || {};

    const filter = {};

    if (partnerId) filter.partner = partnerId;
    if (countryCode) filter.countryCode = String(countryCode).trim().toUpperCase();
    if (typeof isActive !== "undefined") filter.isActive = String(isActive) === "true";

    if (typeof used !== "undefined") {
      const wantUsed = String(used) === "true";
      filter["usage.usedCount"] = wantUsed ? { $gt: 0 } : 0;
    }

    const codes = await InsuranceCode.find(filter)
      .populate("partner", "name partnerCode")
      .sort({ createdAt: -1 })
      .limit(500);

    return res.status(200).json({ codes });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load codes", error: err.message });
  }
});

router.patch("/admin/codes/:id/disable", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await disableInsuranceCode({
      codeId: id,
      updatedBy: req.user?._id || null,
    });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Disable failed", error: err.message });
  }
});

router.post("/admin/codes/:id/mark-used", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const codeDoc = await InsuranceCode.findById(id);
    if (!codeDoc) return res.status(404).json({ message: "Code not found" });

    const result = await markInsuranceCodeUsed({
      partnerId: codeDoc.partner,
      code: codeDoc.code,
      countryCode: codeDoc.countryCode,
      userId: req.body?.userId || null,
    });

    if (!result.ok) return res.status(400).json(result);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Mark used failed", error: err.message });
  }
});

export default router;