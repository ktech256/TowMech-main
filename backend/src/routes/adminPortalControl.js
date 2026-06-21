// backend/src/routes/adminPortalControl.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import Partner from "../models/Partner.js";
import InsurancePartner from "../models/InsurancePartner.js";
import GlobalPortalSettings from "../models/GlobalPortalSettings.js";
import FinancialLog from "../models/FinancialLog.js";
import User from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import { sendPartnerInvitation } from "../services/PartnerInvitationService.js";

const router = express.Router();

/**
 * Admin-only verification
 */
const requireAdmin = async (req, res, next) => {
  if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
};

/**
 * ✅ Get Global Portal Settings
 */
router.get("/settings", auth, requireAdmin, async (req, res) => {
  try {
    let settings = await GlobalPortalSettings.findOne();
    if (!settings) {
      settings = await GlobalPortalSettings.create({});
    }
    return res.status(200).json({ settings });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch settings", error: err.message });
  }
});

/**
 * ✅ Update Global Portal Settings
 */
router.patch("/settings", auth, requireAdmin, async (req, res) => {
  try {
    const settings = await GlobalPortalSettings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    return res.status(200).json({ message: "Settings updated ✅", settings });
  } catch (err) {
    return res.status(500).json({ message: "Update failed", error: err.message });
  }
});

/**
 * ✅ Force Logout All Partners
 */
router.post("/force-logout", auth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    await GlobalPortalSettings.findOneAndUpdate({}, { forceLogoutAllPartners: now }, { upsert: true });
    return res.status(200).json({ message: "Global partner session invalidation triggered ✅" });
  } catch (err) {
    return res.status(500).json({ message: "Action failed", error: err.message });
  }
});

/**
 * ✅ List All Partners with Extended Details
 */
router.get("/partners", auth, requireAdmin, async (req, res) => {
  try {
    const { type, countryCode } = req.query;
    const filter = {};
    if (countryCode) filter.countryCode = countryCode;

    let partners = [];
    if (type === "INSURANCE") {
       partners = await InsurancePartner.find(filter).sort({ createdAt: -1 });
    } else if (type === "FLEET" || type === "MECHANIC") {
       filter.type = type;
       partners = await Partner.find(filter).sort({ createdAt: -1 });
    } else {
       // Return both if no type specified
       const [fleet, insurance] = await Promise.all([
          Partner.find(filter).sort({ createdAt: -1 }),
          InsurancePartner.find(filter).sort({ createdAt: -1 })
       ]);
       partners = [...fleet, ...insurance];
    }

    // Enhance with metrics
    const enhancedPartners = await Promise.all(partners.map(async (p) => {
      const drivers = await User.find({ partnerId: p._id }).distinct("_id");
      const driverCount = drivers.length;

      const activeJobs = await Job.countDocuments({
         $or: [
            { assignedTo: { $in: drivers } },
            { "insurance.partnerId": p._id }
         ],
         status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] }
      });

      // Revenue aggregation
      const now = new Date();
      const startOfDay = new Date(now.setHours(0,0,0,0));
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [todayJobs, weeklyJobs, monthlyJobs] = await Promise.all([
         Job.find({
            $or: [{ assignedTo: { $in: drivers } }, { "insurance.partnerId": p._id }],
            status: JOB_STATUSES.COMPLETED,
            completedAt: { $gte: startOfDay }
         }).select("pricing.providerAmountDue pricing.estimatedTotal"),
         Job.find({
            $or: [{ assignedTo: { $in: drivers } }, { "insurance.partnerId": p._id }],
            status: JOB_STATUSES.COMPLETED,
            completedAt: { $gte: startOfWeek }
         }).select("pricing.providerAmountDue pricing.estimatedTotal"),
         Job.find({
            $or: [{ assignedTo: { $in: drivers } }, { "insurance.partnerId": p._id }],
            status: JOB_STATUSES.COMPLETED,
            completedAt: { $gte: startOfMonth }
         }).select("pricing.providerAmountDue pricing.estimatedTotal")
      ]);

      const sumRevenue = (jobs) => jobs.reduce((acc, j) => acc + (j.pricing?.providerAmountDue || j.pricing?.estimatedTotal || 0), 0);

      return {
        ...p.toObject(),
        metrics: {
          driverCount,
          activeJobs,
          todayRevenue: sumRevenue(todayJobs),
          weeklyRevenue: sumRevenue(weeklyJobs),
          monthlyRevenue: sumRevenue(monthlyJobs)
        }
      };
    }));

    return res.status(200).json({ partners: enhancedPartners });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch partners", error: err.message });
  }
});

/**
 * ✅ Activate/Suspend Partner
 */
router.patch("/partners/:id/status", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, isSuspended, type } = req.body;

    let partner;
    if (type === "INSURANCE") {
       partner = await InsurancePartner.findById(id);
    } else {
       partner = await Partner.findById(id);
    }

    if (!partner) return res.status(404).json({ message: "Partner not found" });

    if (status) partner.status = status;
    if (typeof isSuspended === "boolean") partner.isSuspended = isSuspended;

    await partner.save();
    return res.status(200).json({ message: "Partner status updated ✅", partner });
  } catch (err) {
    return res.status(500).json({ message: "Update failed", error: err.message });
  }
});

/**
 * ✅ Get Partner Audit Logs
 */
router.get("/audit-logs", auth, requireAdmin, async (req, res) => {
  try {
    const { partnerId, action } = req.query;
    const filter = { entityType: "PARTNER" };
    if (partnerId) filter.entityId = partnerId;
    if (action) filter.action = action;

    const logs = await FinancialLog.find(filter)
      .populate("performedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(200);

    return res.status(200).json({ logs });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch logs", error: err.message });
  }
});

/**
 * ✅ Get Partner Detailed Metrics (Drivers + Live Map)
 */
router.get("/partners/:id/details", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const partner = await Partner.findById(id);
    if (!partner) return res.status(404).json({ message: "Partner not found" });

    const drivers = await User.find({ partnerId: id }).select("name phone providerProfile.location providerProfile.isOnline");
    const activeJobs = await Job.find({
       $or: [
          { assignedTo: { $in: drivers.map(d => d._id) } },
          { "insurance.partnerId": id }
       ],
       status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] }
    });

    return res.status(200).json({
       partner,
       drivers,
       activeJobs
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch details", error: err.message });
  }
});

/**
 * ✅ Regenerate Invitation / Activation Token
 */
router.post("/partners/:id/regenerate-token", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;

    let partner;
    if (type === "INSURANCE") {
       partner = await InsurancePartner.findById(id);
    } else {
       partner = await Partner.findById(id);
    }

    if (!partner) return res.status(404).json({ message: "Partner not found" });

    // Mark as pending and send invitation
    partner.status = "PENDING_ACTIVATION";
    const sent = await sendPartnerInvitation(req, partner);

    if (sent) {
       return res.status(200).json({ message: "Activation token regenerated and invitation resent ✅" });
    } else {
       return res.status(500).json({ message: "Failed to send invitation email" });
    }
  } catch (err) {
    return res.status(500).json({ message: "Action failed", error: err.message });
  }
});

export default router;
