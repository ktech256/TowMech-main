// backend/src/controllers/insuranceController.js
import InsurancePartner from "../models/InsurancePartner.js";
import InsuranceCode from "../models/InsuranceCode.js";

import {
  generateCodesForPartner,
  validateInsuranceCode,
  markInsuranceCodeUsed,
  disableInsuranceCode,
  computePartnerUsageSummary,
} from "../services/insurance/codeService.js";

/**
 * Helper: normalize country
 */
function normalizeCountryCode(input, fallback = "ZA") {
  const cc = String(input || "").trim().toUpperCase();
  return cc || fallback;
}

/**
 * ============================
 * PUBLIC (APP)
 * ============================
 */

/**
 * GET /api/insurance/partners
 */
export async function listInsurancePartners(req, res) {
  try {
    const countryCode = normalizeCountryCode(
      req.headers["x-country-code"] || req.query.countryCode || "ZA"
    );

    const partners = await InsurancePartner.find({
      isActive: true,
      countryCodes: { $in: [countryCode] },
    })
      .select("name partnerCode logoUrl description countryCodes isActive createdAt")
      .sort({ name: 1 });

    return res.status(200).json({ partners, countryCode });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load partners", error: err.message });
  }
}

/**
 * POST /api/insurance/validate-code
 * Body: { partnerId, code, phone?, email? }
 */
export async function validateCode(req, res) {
  try {
    const countryCode = normalizeCountryCode(
      req.headers["x-country-code"] || req.body?.countryCode || "ZA"
    );

    const { partnerId, code, phone, email } = req.body || {};

    const result = await validateInsuranceCode({
      partnerId,
      code,
      phone,
      email,
      countryCode,
    });

    if (!result.ok) return res.status(400).json(result);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Validation failed", error: err.message });
  }
}

/**
 * ============================
 * ADMIN (DASHBOARD)
 * ============================
 */

/**
 * GET /api/insurance/admin/partners
 */
export async function adminListPartners(req, res) {
  try {
    const partners = await InsurancePartner.find()
      .select(
        "name partnerCode email phone logoUrl description countryCodes isActive createdAt updatedAt"
      )
      .sort({ createdAt: -1 });

    return res.status(200).json({ partners });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load partners", error: err.message });
  }
}

/**
 * POST /api/insurance/admin/partners
 */
export async function adminCreatePartner(req, res) {
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
}

/**
 * PATCH /api/insurance/admin/partners/:id
 */
export async function adminUpdatePartner(req, res) {
  try {
    const { id } = req.params;

    const partner = await InsurancePartner.findById(id);
    if (!partner) return res.status(404).json({ message: "Partner not found" });

    const {
      name,
      email,
      phone,
      logoUrl,
      description,
      countryCodes,
      isActive,
    } = req.body || {};

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
}

/**
 * POST /api/insurance/admin/partners/:partnerId/codes/generate
 */
export async function adminGenerateCodes(req, res) {
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
      countryCode: normalizeCountryCode(countryCode, "ZA"),
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      message: "Codes generated ✅",
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ message: "Generate failed", error: err.message });
  }
}

/**
 * GET /api/insurance/admin/codes
 */
export async function adminListCodes(req, res) {
  try {
    const { partnerId, countryCode, isActive, used } = req.query || {};

    const filter = {};

    if (partnerId) filter.partner = partnerId;
    if (countryCode) filter.countryCode = normalizeCountryCode(countryCode);
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
}

/**
 * PATCH /api/insurance/admin/codes/:id/disable
 */
export async function adminDisableCode(req, res) {
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
}

/**
 * GET /api/insurance/admin/partners/:partnerId/usage
 * Usage summary for invoices
 */
export async function adminPartnerUsage(req, res) {
  try {
    const { partnerId } = req.params;

    const countryCode = normalizeCountryCode(
      req.query?.countryCode || req.headers["x-country-code"] || "ZA"
    );

    const summary = await computePartnerUsageSummary({
      partnerId,
      countryCode,
    });

    return res.status(200).json({ ok: true, summary });
  } catch (err) {
    return res.status(500).json({ message: "Usage summary failed", error: err.message });
  }
}