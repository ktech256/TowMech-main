// backend/src/routes/insurancePortal.js
import express from "express";
import auth from "../middleware/auth.js";
import InsurancePartner from "../models/InsurancePartner.js";
import InsuranceCode from "../models/InsuranceCode.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import { generateCodesForPartner } from "../services/insurance/codeService.js";
import { logAuditEvent } from "../utils/auditLogger.js";

const router = express.Router();

const requirePartnerAccess = async (req, res, next) => {
  if (!req.user.partnerId) {
    return res.status(403).json({ message: "Access denied. Partner account required." });
  }

  const partner = await InsurancePartner.findById(req.user.partnerId);
  if (!partner) return res.status(403).json({ message: "Partner record not found." });

  // 🌍 STRICT COUNTRY ISOLATION
  const requestedCountry = String(req.countryCode || "ZA").toUpperCase();
  // Insurance partners might support multiple countries
  const allowedCountries = Array.isArray(partner.countryCodes) ? partner.countryCodes : [partner.countryCode];

  if (!allowedCountries.includes(requestedCountry)) {
    return res.status(403).json({
      message: `Access denied. Your insurer account is not authorized for ${requestedCountry}.`,
      allowed: allowedCountries,
      requested: requestedCountry
    });
  }

  req.partner = partner;
  next();
};

/**
 * ✅ INSURANCE DASHBOARD METRICS
 */
router.get("/metrics", auth, requirePartnerAccess, async (req, res) => {
  try {
    const partnerId = req.user.partnerId;

    const totalCodes = await InsuranceCode.countDocuments({ partner: partnerId });
    const usedCodes = await InsuranceCode.countDocuments({ partner: partnerId, "usage.usedCount": { $gt: 0 } });
    const activeJobs = await Job.countDocuments({ "insurance.partnerId": partnerId, status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] } });
    const completedJobs = await Job.countDocuments({ "insurance.partnerId": partnerId, status: JOB_STATUSES.COMPLETED });

    return res.status(200).json({
      totalCodes,
      usedCodes,
      unusedCodes: totalCodes - usedCodes,
      activeJobs,
      completedJobs
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch metrics", error: err.message });
  }
});

/**
 * ✅ GENERATE CODES
 */
router.post("/codes", auth, requirePartnerAccess, async (req, res) => {
  try {
    const { count, length, expiresInDays, maxUses, countryCode } = req.body;

    const result = await generateCodesForPartner({
      partnerId: req.user.partnerId,
      count,
      length,
      expiresInDays,
      maxUses,
      countryCode,
      createdBy: req.user._id
    });

    await logAuditEvent(req, {
      action: "PARTNER_CODE_CREATED",
      entityType: "PARTNER",
      entityId: req.user.partnerId,
      details: { count, type: "INSURANCE" }
    });

    return res.status(201).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Failed to generate codes", error: err.message });
  }
});

/**
 * ✅ VIEW JOBS (Isolation)
 */
router.get("/jobs", auth, requirePartnerAccess, async (req, res) => {
  try {
    const jobs = await Job.find({ "insurance.partnerId": req.user.partnerId })
      .populate("customer", "name phone")
      .populate("assignedTo", "name phone")
      .sort({ createdAt: -1 });

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch jobs", error: err.message });
  }
});

/**
 * ✅ DISABLE CODES
 */
router.patch("/codes/:codeId/disable", auth, requirePartnerAccess, async (req, res) => {
  try {
    const { codeId } = req.params;
    const code = await InsuranceCode.findOne({ _id: codeId, partner: req.user.partnerId });

    if (!code) return res.status(404).json({ message: "Code not found" });

    code.isActive = false;
    await code.save();

    return res.status(200).json({ message: "Code disabled successfully ✅" });
  } catch (err) {
    return res.status(500).json({ message: "Disable failed", error: err.message });
  }
});

/**
 * ✅ VIEW STATEMENTS / UTILIZATION
 */
router.get("/statements", auth, requirePartnerAccess, async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ message: "from and to dates are required" });
    }

    const maxMonths = 12;
    const limitDate = new Date();
    limitDate.setMonth(limitDate.getMonth() - maxMonths);

    if (new Date(from) < limitDate) {
      return res.status(400).json({ message: `Insurance statements are limited to the last ${maxMonths} months.` });
    }

    const filter = {
      "insurance.partnerId": req.user.partnerId,
      status: JOB_STATUSES.COMPLETED,
      completedAt: { $gte: new Date(from), $lte: new Date(to) }
    };

    const jobs = await Job.find(filter)
      .populate("customer", "name phone")
      .populate("assignedTo", "name phone")
      .sort({ completedAt: -1 });

    const totalRevenue = jobs.reduce((acc, job) => acc + (job.pricing?.estimatedTotal || 0), 0);
    const utilization = jobs.length;

    return res.status(200).json({
      period: { from, to },
      jobs,
      totalRevenue,
      utilization
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch statements", error: err.message });
  }
});

export default router;
