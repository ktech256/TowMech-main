// backend/src/routes/fleetPortal.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import Partner from "../models/Partner.js";
import DriverVerificationCode from "../models/DriverVerificationCode.js";
import crypto from "crypto";
import { logAuditEvent } from "../utils/auditLogger.js";

const router = express.Router();

/**
 * Middleware: Require Partner Admin/Operator
 */
const requirePartnerAccess = async (req, res, next) => {
  if (!req.user.partnerId) {
    return res.status(403).json({ message: "Access denied. Partner account required." });
  }

  const partner = await Partner.findById(req.user.partnerId);
  if (!partner) return res.status(403).json({ message: "Partner record not found." });

  // 🌍 STRICT COUNTRY ISOLATION
  const requestedCountry = String(req.countryCode || "ZA").toUpperCase();
  if (partner.countryCode !== requestedCountry) {
    return res.status(403).json({
      message: `Access denied. Your account is restricted to ${partner.countryCode}.`,
      partnerCountry: partner.countryCode,
      requestedCountry
    });
  }

  req.partner = partner;
  next();
};

/**
 * ✅ FLEET DASHBOARD METRICS
 */
router.get("/metrics", auth, requirePartnerAccess, async (req, res) => {
  try {
    const partnerId = req.user.partnerId;

    const totalDrivers = await User.countDocuments({ partnerId, role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] } });
    const onlineDrivers = await User.countDocuments({ partnerId, "providerProfile.isOnline": true });

    // Busy Drivers = Online + Active Job
    const busyDrivers = await Job.distinct("assignedTo", {
      status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] },
      assignedTo: { $in: await User.find({ partnerId }).distinct("_id") }
    });

    const activeJobs = await Job.countDocuments({
      status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] },
      assignedTo: { $in: await User.find({ partnerId }).distinct("_id") }
    });

    const completedJobs = await Job.countDocuments({
      status: JOB_STATUSES.COMPLETED,
      assignedTo: { $in: await User.find({ partnerId }).distinct("_id") }
    });

    // Revenue calculation
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const jobs = await Job.find({
      status: JOB_STATUSES.COMPLETED,
      assignedTo: { $in: await User.find({ partnerId }).distinct("_id") },
      completedAt: { $gte: startOfDay }
    }).select("pricing.providerAmountDue");

    const todayRevenue = jobs.reduce((acc, job) => acc + (job.pricing?.providerAmountDue || 0), 0);

    return res.status(200).json({
      totalDrivers,
      onlineDrivers,
      offlineDrivers: totalDrivers - onlineDrivers,
      busyDrivers: busyDrivers.length,
      activeJobs,
      completedJobs,
      todayRevenue,
      // weekly/monthly to be aggregated similarly
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch metrics", error: err.message });
  }
});

/**
 * ✅ VIEW STATEMENTS
 */
router.get("/statements", auth, requirePartnerAccess, async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ message: "from and to dates are required" });
    }

    const maxMonths = 6;
    const limitDate = new Date();
    limitDate.setMonth(limitDate.getMonth() - maxMonths);

    if (new Date(from) < limitDate) {
      return res.status(400).json({ message: `Fleet statements are limited to the last ${maxMonths} months.` });
    }

    const drivers = await User.find({ partnerId: req.user.partnerId }).distinct("_id");

    const jobs = await Job.find({
      assignedTo: { $in: drivers },
      status: JOB_STATUSES.COMPLETED,
      completedAt: { $gte: new Date(from), $lte: new Date(to) }
    }).populate("assignedTo", "name phone")
      .sort({ completedAt: -1 });

    const totalRevenue = jobs.reduce((acc, job) => acc + (job.pricing?.providerAmountDue || 0), 0);

    return res.status(200).json({
      period: { from, to },
      jobs,
      totalRevenue
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch statements", error: err.message });
  }
});

/**
 * ✅ FLEET LIVE MAP
 */
router.get("/live-map", auth, requirePartnerAccess, async (req, res) => {
  try {
    const drivers = await User.find({
      partnerId: req.user.partnerId,
      role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] }
    }).select("name phone providerProfile.location providerProfile.isOnline");

    // Enhance with busy status
    const busyDriverIds = await Job.distinct("assignedTo", {
      status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] }
    });

    const markers = drivers.map(d => ({
      _id: d._id,
      name: d.name,
      location: d.providerProfile?.location,
      isOnline: d.providerProfile?.isOnline,
      isBusy: busyDriverIds.some(id => id.equals(d._id))
    }));

    return res.status(200).json({ markers });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch live map", error: err.message });
  }
});

/**
 * ✅ GENERATE DRIVER VERIFICATION CODES
 */
router.post("/driver-codes", auth, requirePartnerAccess, async (req, res) => {
  try {
    const { count = 1, expiresInDays = 7 } = req.body;
    const codes = [];

    for (let i = 0; i < count; i++) {
      const code = `DRV-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

      const doc = await DriverVerificationCode.create({
        code,
        partnerId: req.user.partnerId,
        expiresAt,
        createdBy: req.user._id
      });
      codes.push(doc);
    }

    await logAuditEvent(req, {
      action: "PARTNER_CODE_CREATED",
      entityType: "PARTNER",
      entityId: req.user.partnerId,
      details: { count, codes: codes.map(c => c.code) }
    });

    return res.status(201).json({ message: "Codes generated ✅", codes });
  } catch (err) {
    return res.status(500).json({ message: "Failed to generate codes", error: err.message });
  }
});

/**
 * ✅ REVOKE DRIVER CODE
 */
router.patch("/driver-codes/:codeId/revoke", auth, requirePartnerAccess, async (req, res) => {
  try {
    const { codeId } = req.params;
    const code = await DriverVerificationCode.findOne({ _id: codeId, partnerId: req.user.partnerId });

    if (!code) return res.status(404).json({ message: "Code not found" });

    code.isRevoked = true;
    await code.save();

    await logAuditEvent(req, {
      action: "PARTNER_CODE_REVOKED",
      entityType: "PARTNER",
      entityId: req.user.partnerId,
      details: { codeId, code: code.code }
    });

    return res.status(200).json({ message: "Code revoked successfully ✅" });
  } catch (err) {
    return res.status(500).json({ message: "Revoke failed", error: err.message });
  }
});

/**
 * ✅ VIEW DRIVER CODE USAGE
 */
router.get("/driver-codes/usage", auth, requirePartnerAccess, async (req, res) => {
  try {
    const codes = await DriverVerificationCode.find({ partnerId: req.user.partnerId })
      .populate("usedBy", "name phone email")
      .sort({ createdAt: -1 });

    return res.status(200).json({ codes });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch usage", error: err.message });
  }
});

export default router;
