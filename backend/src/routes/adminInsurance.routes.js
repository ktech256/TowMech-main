// backend/src/routes/adminInsurance.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";

import InsurancePartner from "../models/InsurancePartner.js";
import InsuranceCode from "../models/InsuranceCode.js";
import Job from "../models/Job.js";

import { generateCodesForPartner, disableInsuranceCode } from "../services/insurance/codeService.js";

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
    return res.status(500).json({ message: "Auth error", error: err.message });
  }
}

function parseMonthToRange(month) {
  // month: YYYY-MM (assume UTC)
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

function parseDateParam(d) {
  // expects YYYY-MM-DD or ISO; return Date or null
  if (!d) return null;
  const dt = new Date(String(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function toIso(d) {
  try {
    return d ? new Date(d).toISOString() : null;
  } catch {
    return null;
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
    return res.status(500).json({ message: "Failed to load partners", error: err.message });
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
    return res.status(500).json({ message: "Create failed", error: err.message });
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
    return res.status(500).json({ message: "Update failed", error: err.message });
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
    return res.status(500).json({ message: "Failed to load codes", error: err.message });
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
    return res.status(500).json({ message: "Generate failed", error: err.message });
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
    return res.status(500).json({ message: "Disable failed", error: err.message });
  }
});

/**
 * ============================
 * INVOICE (REAL JOB-BASED)
 * ============================
 *
 * GET /api/admin/insurance/invoice
 * Query:
 * - partnerId (required)
 * - countryCode (optional, header or query)
 * - month=YYYY-MM  OR  from=YYYY-MM-DD&to=YYYY-MM-DD (preferred for custom)
 * - providerId (optional) -> filter assignedTo
 */
router.get("/invoice", auth, requireAdmin, async (req, res) => {
  try {
    const partnerId = String(req.query?.partnerId || "").trim();
    if (!partnerId) return res.status(400).json({ message: "partnerId is required" });

    const countryCode = resolveReqCountryCode(req);

    const month = String(req.query?.month || "").trim();
    const from = parseDateParam(req.query?.from);
    const to = parseDateParam(req.query?.to);

    const providerId = String(req.query?.providerId || "").trim() || null;

    let rangeStart = null;
    let rangeEnd = null;

    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ message: "month must be in YYYY-MM format" });
      }
      const r = parseMonthToRange(month);
      rangeStart = r.start;
      rangeEnd = r.end;
    } else if (from && to) {
      // inclusive "to" date: set end to next day 00:00
      const start = new Date(from);
      const end = new Date(to);
      end.setUTCHours(0, 0, 0, 0);
      end.setUTCDate(end.getUTCDate() + 1);
      rangeStart = start;
      rangeEnd = end;
    } else {
      return res.status(400).json({ message: "Provide month=YYYY-MM OR from & to dates" });
    }

    const partner = await InsurancePartner.findById(partnerId).select("name partnerCode email phone");
    if (!partner) return res.status(404).json({ message: "Partner not found" });

    const filter = {
      countryCode,
      "insurance.enabled": true,
      "insurance.partnerId": partnerId,
      createdAt: { $gte: rangeStart, $lt: rangeEnd },
    };

    if (providerId) filter.assignedTo = providerId;

    const jobs = await Job.find(filter)
      .select(
        "title status createdAt updatedAt roleNeeded pickupAddressText dropoffAddressText pricing insurance customer assignedTo"
      )
      .populate("assignedTo", "name email phone role")
      .populate("customer", "name email phone role")
      .sort({ createdAt: -1 })
      .lean();

    // totals
    let totalJobs = 0;
    let totalEstimatedTotal = 0; // pricing.estimatedTotal
    let totalBookingFeeWaived = 0; // pricing.bookingFee
    let totalCommission = 0;
    let totalProviderDue = 0;

    const items = jobs.map((j) => {
      totalJobs += 1;

      const estimatedTotal = Number(j?.pricing?.estimatedTotal || 0) || 0;
      const bookingFee = Number(j?.pricing?.bookingFee || 0) || 0;
      const commission = Number(j?.pricing?.commissionAmount || 0) || 0;
      const providerDue = Number(j?.pricing?.providerAmountDue || 0) || 0;

      totalEstimatedTotal += estimatedTotal;
      totalBookingFeeWaived += bookingFee;
      totalCommission += commission;
      totalProviderDue += providerDue;

      return {
        jobId: String(j?._id),
        shortId: String(j?._id).slice(-8).toUpperCase(),
        createdAt: toIso(j.createdAt),
        status: j.status,
        roleNeeded: j.roleNeeded,

        pickupAddressText: j.pickupAddressText || null,
        dropoffAddressText: j.dropoffAddressText || null,

        provider: j.assignedTo
          ? {
              providerId: String(j.assignedTo?._id || ""),
              name: j.assignedTo?.name || null,
              email: j.assignedTo?.email || null,
              phone: j.assignedTo?.phone || null,
            }
          : null,

        customer: j.customer
          ? {
              customerId: String(j.customer?._id || ""),
              name: j.customer?.name || null,
              email: j.customer?.email || null,
              phone: j.customer?.phone || null,
            }
          : null,

        pricing: {
          currency: j?.pricing?.currency || "ZAR",
          estimatedTotal,
          bookingFee,
          commissionAmount: commission,
          providerAmountDue: providerDue,
          estimatedDistanceKm: Number(j?.pricing?.estimatedDistanceKm || 0) || 0,
        },

        insurance: {
          enabled: !!j?.insurance?.enabled,
          code: j?.insurance?.code || null,
          partnerId: String(j?.insurance?.partnerId || ""),
          validatedAt: toIso(j?.insurance?.validatedAt),
        },
      };
    });

    // group by provider (who you owe)
    const byProviderMap = new Map(); // providerId -> summary
    for (const it of items) {
      const pid = it?.provider?.providerId;
      if (!pid) continue;
      const cur = byProviderMap.get(pid) || {
        providerId: pid,
        name: it?.provider?.name || null,
        jobCount: 0,
        totalProviderAmountDue: 0,
        currency: it?.pricing?.currency || "ZAR",
      };
      cur.jobCount += 1;
      cur.totalProviderAmountDue += Number(it?.pricing?.providerAmountDue || 0) || 0;
      if (!cur.name && it?.provider?.name) cur.name = it.provider.name;
      byProviderMap.set(pid, cur);
    }

    const groupedByProvider = Array.from(byProviderMap.values()).sort(
      (a, b) => (b.totalProviderAmountDue || 0) - (a.totalProviderAmountDue || 0)
    );

    const invoice = {
      ok: true,
      invoice: {
        partner: {
          partnerId: String(partner._id),
          name: partner.name,
          partnerCode: partner.partnerCode,
          email: partner.email || null,
          phone: partner.phone || null,
        },
        countryCode,
        currency: "ZAR",
        period: {
          month: month || null,
          from: toIso(rangeStart),
          to: toIso(rangeEnd),
        },
        filters: {
          providerId: providerId || null,
        },
        totals: {
          totalJobs,
          totalEstimatedTotal,
          totalBookingFeeWaived,
          totalCommission,
          totalProviderAmountDue: totalProviderDue,
        },
        items,
        groupedByProvider,
      },
    };

    return res.status(200).json(invoice);
  } catch (err) {
    return res.status(500).json({ message: "Invoice fetch failed", error: err.message });
  }
});

/**
 * GET /api/admin/insurance/invoice/pdf
 * Same query params as /invoice.
 *
 * NOTE: This endpoint is a STUB unless you install a PDF generator (pdfkit / puppeteer).
 * For now it returns 501 with instructions.
 */
router.get("/invoice/pdf", auth, requireAdmin, async (req, res) => {
  try {
    return res.status(501).json({
      message:
        "PDF export not enabled yet. Install pdfkit/puppeteer and implement server-side PDF rendering.",
    });
  } catch (err) {
    return res.status(500).json({ message: "PDF failed", error: err.message });
  }
});

export default router;