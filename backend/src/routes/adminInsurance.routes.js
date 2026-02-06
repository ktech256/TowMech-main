// backend/src/routes/adminInsurance.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";

import InsurancePartner from "../models/InsurancePartner.js";
import InsuranceCode from "../models/InsuranceCode.js";
import Job from "../models/Job.js";

import { generateCodesForPartner, disableInsuranceCode } from "../services/insurance/codeService.js";

// ✅ Invoice builder + PDF renderers
import { buildInsuranceInvoice } from "../services/insurance/invoiceService.js";
import {
  renderPartnerInvoicePdfBuffer,
  renderProvidersSummaryPdfBuffer,
  renderProviderDetailPdfBuffer,
} from "../utils/pdf/invoicePdf.js";

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

/**
 * Admin-only middleware
 */
async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const user = await User.findById(userId).select("role permissions countryCode");
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    req.adminUser = user;
    return next();
  } catch (err) {
    return res.status(500).json({
      message: "Auth error",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
}

/**
 * ============================
 * PARTNERS
 * ============================
 */

// GET /api/admin/insurance/partners
router.get("/partners", auth, requireAdmin, async (req, res) => {
  try {
    const countryCode = resolveReqCountryCode(req);

    const partners = await InsurancePartner.find(
      countryCode ? { countryCodes: { $in: [countryCode] } } : {}
    )
      .select("name partnerCode email phone logoUrl description countryCodes isActive createdAt updatedAt")
      .sort({ createdAt: -1 });

    return res.status(200).json({ partners });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to load partners",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

// POST /api/admin/insurance/partners
router.post("/partners", auth, requireAdmin, async (req, res) => {
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
    return res.status(500).json({
      message: "Create failed",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

// PATCH /api/admin/insurance/partners/:id
router.patch("/partners/:id", auth, requireAdmin, async (req, res) => {
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
    return res.status(500).json({
      message: "Update failed",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

/**
 * ============================
 * CODES
 * ============================
 */

// GET /api/admin/insurance/codes
router.get("/codes", auth, requireAdmin, async (req, res) => {
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
    return res.status(500).json({
      message: "Failed to load codes",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

// POST /api/admin/insurance/codes/generate
router.post("/codes/generate", auth, requireAdmin, async (req, res) => {
  try {
    const {
      partnerId,
      count = 50,
      length = 8,
      expiresInDays = 365,
      maxUses = 1,
      countryCode = "ZA",
    } = req.body || {};

    if (!partnerId) return res.status(400).json({ message: "partnerId is required" });

    const result = await generateCodesForPartner({
      partnerId,
      count: Number(count),
      length: Number(length),
      expiresInDays: Number(expiresInDays),
      maxUses: Number(maxUses),
      countryCode: String(countryCode).trim().toUpperCase(),
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({ message: "Codes generated ✅", ...result });
  } catch (err) {
    return res.status(500).json({
      message: "Generate failed",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

// PATCH /api/admin/insurance/codes/:id/disable
router.patch("/codes/:id/disable", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await disableInsuranceCode({
      codeId: id,
      updatedBy: req.user?._id || null,
    });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      message: "Disable failed",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

/**
 * ============================
 * INVOICE JSON
 * ============================
 */
router.get("/invoice", auth, requireAdmin, async (req, res) => {
  try {
    const countryCode = resolveReqCountryCode(req);

    const invoice = await buildInsuranceInvoice({
      countryCode,
      partnerId: String(req.query?.partnerId || "").trim(),
      month: String(req.query?.month || "").trim() || null,
      from: String(req.query?.from || "").trim() || null,
      to: String(req.query?.to || "").trim() || null,
      providerId: String(req.query?.providerId || "").trim() || null,
    });

    return res.status(200).json({ ok: true, invoice });
  } catch (err) {
    return res.status(500).json({
      message: "Invoice fetch failed",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

/**
 * ============================
 * 1) Partner invoice PDF (what insurer owes you)
 * ============================
 */
router.get("/invoice/pdf", auth, requireAdmin, async (req, res) => {
  try {
    const countryCode = resolveReqCountryCode(req);

    const invoice = await buildInsuranceInvoice({
      countryCode,
      partnerId: String(req.query?.partnerId || "").trim(),
      month: String(req.query?.month || "").trim() || null,
      from: String(req.query?.from || "").trim() || null,
      to: String(req.query?.to || "").trim() || null,
      providerId: String(req.query?.providerId || "").trim() || null,
    });

    const pdfBuffer = await renderPartnerInvoicePdfBuffer(invoice);

    const filename = invoice?.period?.month
      ? `partner-invoice-${invoice.countryCode}-${invoice.period.month}.pdf`
      : `partner-invoice-${invoice.countryCode}-${invoice.period.from}-to-${invoice.period.to}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error("PDF ERROR /invoice/pdf:", err);
    return res.status(500).json({
      message: "PDF failed",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

/**
 * ============================
 * 2) Providers owed summary PDF (tabulated)
 * ============================
 * GET /api/admin/insurance/providers/pdf
 * Query: partnerId + month/from/to (same as invoice)
 */
router.get("/providers/pdf", auth, requireAdmin, async (req, res) => {
  try {
    const countryCode = resolveReqCountryCode(req);

    const invoice = await buildInsuranceInvoice({
      countryCode,
      partnerId: String(req.query?.partnerId || "").trim(),
      month: String(req.query?.month || "").trim() || null,
      from: String(req.query?.from || "").trim() || null,
      to: String(req.query?.to || "").trim() || null,
      providerId: null, // summary is all providers
    });

    const pdfBuffer = await renderProvidersSummaryPdfBuffer(invoice);

    const filename = invoice?.period?.month
      ? `providers-owed-${invoice.countryCode}-${invoice.period.month}.pdf`
      : `providers-owed-${invoice.countryCode}-${invoice.period.from}-to-${invoice.period.to}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error("PDF ERROR /providers/pdf:", err);
    return res.status(500).json({
      message: "Providers PDF failed",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

/**
 * ============================
 * 3) Provider detailed statement PDF
 * ============================
 * GET /api/admin/insurance/provider/pdf
 * Query: partnerId + providerId + month/from/to
 */
router.get("/provider/pdf", auth, requireAdmin, async (req, res) => {
  try {
    const countryCode = resolveReqCountryCode(req);

    const providerId = String(req.query?.providerId || "").trim();
    if (!providerId) return res.status(400).json({ message: "providerId is required" });

    const invoice = await buildInsuranceInvoice({
      countryCode,
      partnerId: String(req.query?.partnerId || "").trim(),
      month: String(req.query?.month || "").trim() || null,
      from: String(req.query?.from || "").trim() || null,
      to: String(req.query?.to || "").trim() || null,
      providerId, // build invoice filtered to that provider
    });

    const pdfBuffer = await renderProviderDetailPdfBuffer(invoice, providerId);

    const filename = invoice?.period?.month
      ? `provider-statement-${invoice.countryCode}-${invoice.period.month}-${providerId}.pdf`
      : `provider-statement-${invoice.countryCode}-${invoice.period.from}-to-${invoice.period.to}-${providerId}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error("PDF ERROR /provider/pdf:", err);
    return res.status(500).json({
      message: "Provider PDF failed",
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }
});

export default router;