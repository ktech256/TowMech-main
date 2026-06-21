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
import { EmailService } from "../services/EmailService.js";
import InsuranceCode from "../models/InsuranceCode.js";
import DriverVerificationCode from "../models/DriverVerificationCode.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { generateCodesForPartner } from "../services/insurance/codeService.js";
import crypto from "crypto";

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
 * STRICT COUNTRY ISOLATION ENFORCED
 */
router.get("/partners", auth, requireAdmin, async (req, res) => {
  try {
    const { type } = req.query;
    const countryCode = req.countryCode; // STRICT ISOLATION from header via tenant middleware

    const filter = {
       $or: [
          { countryCode: countryCode },
          { countryCodes: countryCode }
       ]
    };

    let partners = [];
    if (type === "INSURANCE") {
       partners = await InsurancePartner.find({ countryCodes: countryCode }).sort({ createdAt: -1 });
    } else if (type === "FLEET" || type === "MECHANIC") {
       partners = await Partner.find({ countryCode: countryCode, type }).sort({ createdAt: -1 });
    } else {
       // Return both if no type specified
       const [fleet, insurance] = await Promise.all([
          Partner.find({ countryCode: countryCode, type: { $in: ["FLEET", "MECHANIC"] } }).sort({ createdAt: -1 }),
          InsurancePartner.find({ countryCodes: countryCode }).sort({ createdAt: -1 })
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
 * ✅ Edit Partner Details
 */
router.patch("/partners/:id", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { type, name, partnerCode, contactEmail, contactPhone, status, isSuspended, notes } = req.body;

    let partner;
    if (type === "INSURANCE") {
      partner = await InsurancePartner.findById(id);
    } else {
      partner = await Partner.findById(id);
    }

    if (!partner) return res.status(404).json({ message: "Partner not found" });

    // Isolation Check
    if (type === "INSURANCE") {
       if (!partner.countryCodes.includes(req.countryCode)) return res.status(403).json({ message: "Forbidden: Country Isolation Violation" });
    } else {
       if (partner.countryCode !== req.countryCode) return res.status(403).json({ message: "Forbidden: Country Isolation Violation" });
    }

    const previousValue = partner.toObject();

    if (name) partner.name = name;
    if (partnerCode) partner.partnerCode = partnerCode;
    if (contactEmail) partner.contactEmail = contactEmail;
    if (contactPhone) partner.contactPhone = contactPhone;
    if (status) partner.status = status;
    if (typeof isSuspended === "boolean") partner.isSuspended = isSuspended;
    if (typeof notes === "string") partner.notes = notes;

    try {
      await partner.save();
    } catch (saveErr) {
       if (saveErr.code === 11000) {
          return res.status(409).json({ message: "Partner code or email already exists" });
       }
       throw saveErr;
    }

    await logAuditEvent(req, {
       action: "PARTNER_EDITED",
       entityType: "PARTNER",
       entityId: partner._id,
       details: {
          previous: { name: previousValue.name, partnerCode: previousValue.partnerCode, email: previousValue.contactEmail, notes: previousValue.notes },
          new: { name: partner.name, partnerCode: partner.partnerCode, email: partner.contactEmail, notes: partner.notes }
       }
    });

    return res.status(200).json({ message: "Partner updated ✅", partner });
  } catch (err) {
    return res.status(500).json({ message: "Update failed", error: err.message });
  }
});

/**
 * ✅ Get Partner Detailed Metrics (Drivers + Codes + Statements + Analytics)
 * ENFORCES COUNTRY ISOLATION
 */
router.get("/partners/:id/details", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query;

    let partner;
    if (type === "INSURANCE") {
       partner = await InsurancePartner.findById(id).populate("createdBy", "name email");
    } else {
       partner = await Partner.findById(id).populate("createdBy", "name email");
    }

    if (!partner) return res.status(404).json({ message: "Partner not found" });

    // Isolation Check
    if (type === "INSURANCE") {
       if (!partner.countryCodes.includes(req.countryCode)) return res.status(403).json({ message: "Forbidden: Country Isolation Violation" });
    } else {
       if (partner.countryCode !== req.countryCode) return res.status(403).json({ message: "Forbidden: Country Isolation Violation" });
    }

    const drivers = await User.find({ partnerId: id }).select("name phone role providerProfile.location providerProfile.isOnline providerProfile.verificationStatus");

    // Driver Status Breakdown
    const driverStats = {
       total: drivers.length,
       verified: drivers.filter(d => d.providerProfile?.verificationStatus === "APPROVED").length,
       pending: drivers.filter(d => d.providerProfile?.verificationStatus === "PENDING").length,
       online: drivers.filter(d => d.providerProfile?.isOnline).length,
       offline: drivers.filter(d => !d.providerProfile?.isOnline).length,
       busy: 0 // Will update below
    };

    // Analytics Aggregation
    const now = new Date();
    const startOfDay = new Date(now.setHours(0,0,0,0));
    const startOfWeek = new Date(new Date().setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const driverIds = drivers.map(d => d._id);
    const jobFilter = {
       $or: [
          { assignedTo: { $in: driverIds } },
          { "insurance.partnerId": id }
       ]
    };

    const [activeJobs, completedToday, completedWeekly, completedMonthly, cancelledJobs] = await Promise.all([
       Job.find({ ...jobFilter, status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] } }).populate("assignedTo", "name phone"),
       Job.find({ ...jobFilter, status: JOB_STATUSES.COMPLETED, completedAt: { $gte: startOfDay } }),
       Job.find({ ...jobFilter, status: JOB_STATUSES.COMPLETED, completedAt: { $gte: startOfWeek } }),
       Job.find({ ...jobFilter, status: JOB_STATUSES.COMPLETED, completedAt: { $gte: startOfMonth } }),
       Job.countDocuments({ ...jobFilter, status: JOB_STATUSES.CANCELLED })
    ]);

    driverStats.busy = activeJobs.filter(j => j.assignedTo).length;

    const sumRev = (jobs) => jobs.reduce((acc, j) => acc + (j.pricing?.providerAmountDue || j.pricing?.estimatedTotal || 0), 0);

    const analytics = {
       todayRevenue: sumRev(completedToday),
       weeklyRevenue: sumRev(completedWeekly),
       monthlyRevenue: sumRev(completedMonthly),
       completedCount: completedMonthly.length,
       cancelledCount: cancelledJobs,
       insuranceUsage: type === "INSURANCE" ? completedMonthly.length : 0
    };

    // Code Management
    let codeDetails = [];
    let codeStats = {};
    if (type === "INSURANCE") {
       const codes = await InsuranceCode.find({ partner: id }).sort({ createdAt: -1 }).limit(100);
       codeStats = {
          total: codes.length,
          active: codes.filter(c => c.isActive && c.expiresAt > new Date()).length,
          used: codes.reduce((acc, c) => acc + (c.usage?.usedCount || 0), 0),
          expired: codes.filter(c => c.expiresAt <= new Date()).length
       };
       codeDetails = codes;
    } else {
       const codes = await DriverVerificationCode.find({ partnerId: id }).populate("usedBy", "name phone").sort({ createdAt: -1 }).limit(100);
       codeStats = {
          total: codes.length,
          used: codes.filter(c => !!c.usedBy).length,
          unused: codes.filter(c => !c.usedBy && !c.isRevoked && c.expiresAt > new Date()).length,
          expired: codes.filter(c => c.expiresAt <= new Date() && !c.usedBy).length,
          revoked: codes.filter(c => c.isRevoked).length
       };
       codeDetails = codes;
    }

    return res.status(200).json({
       partner,
       driverStats,
       codeStats,
       analytics,
       drivers,
       activeJobs,
       codes: codeDetails
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch details", error: err.message });
  }
});

/**
 * ✅ Get Partner Statements (Fleet or Insurance)
 */
router.get("/partners/:id/statements", auth, requireAdmin, async (req, res) => {
   try {
      const { id } = req.params;
      const { type, from, to } = req.query;

      if (!from || !to) return res.status(400).json({ message: "Date range required" });

      let partner;
      if (type === "INSURANCE") {
         partner = await InsurancePartner.findById(id);
      } else {
         partner = await Partner.findById(id);
      }

      if (!partner) return res.status(404).json({ message: "Partner not found" });

      // Isolation
      if (type === "INSURANCE") {
         if (!partner.countryCodes.includes(req.countryCode)) return res.status(403).json({ message: "Forbidden" });
      } else {
         if (partner.countryCode !== req.countryCode) return res.status(403).json({ message: "Forbidden" });
      }

      const driverIds = await User.find({ partnerId: id }).distinct("_id");
      const filter = {
         $or: [
            { assignedTo: { $in: driverIds } },
            { "insurance.partnerId": id }
         ],
         status: JOB_STATUSES.COMPLETED,
         completedAt: { $gte: new Date(from), $lte: new Date(to) }
      };

      const jobs = await Job.find(filter).populate("assignedTo", "name phone").sort({ completedAt: -1 });
      const totalRevenue = jobs.reduce((acc, j) => acc + (j.pricing?.providerAmountDue || j.pricing?.estimatedTotal || 0), 0);

      return res.status(200).json({ jobs, totalRevenue });
   } catch (err) {
      return res.status(500).json({ message: "Failed to fetch statements", error: err.message });
   }
});

/**
 * ✅ Revoke/Deactivate Code
 */
router.patch("/partners/:id/codes/:codeId", auth, requireAdmin, async (req, res) => {
   try {
      const { id, codeId } = req.params;
      const { type, action } = req.body;

      if (type === "INSURANCE") {
         const code = await InsuranceCode.findOne({ _id: codeId, partner: id });
         if (!code) return res.status(404).json({ message: "Code not found" });
         code.isActive = false;
         await code.save();
      } else {
         const code = await DriverVerificationCode.findOne({ _id: codeId, partnerId: id });
         if (!code) return res.status(404).json({ message: "Code not found" });
         code.isRevoked = true;
         await code.save();
      }

      return res.status(200).json({ message: "Code updated successfully ✅" });
   } catch (err) {
      return res.status(500).json({ message: "Action failed", error: err.message });
   }
});

/**
 * ✅ Generate Codes for Partner (Fleet or Insurance)
 */
router.post("/partners/:id/codes", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { type, count = 1, expiresInDays = 7 } = req.body;

    let partner;
    if (type === "INSURANCE") {
       partner = await InsurancePartner.findById(id);
    } else {
       partner = await Partner.findById(id);
    }

    if (!partner) return res.status(404).json({ message: "Partner not found" });

    // Isolation Check
    if (type === "INSURANCE") {
       if (!partner.countryCodes.includes(req.countryCode)) return res.status(403).json({ message: "Forbidden" });
    } else {
       if (partner.countryCode !== req.countryCode) return res.status(403).json({ message: "Forbidden" });
    }

    const generated = [];
    if (type === "INSURANCE") {
       const result = await generateCodesForPartner({
          partnerId: id,
          count: Number(count),
          expiresInDays: Number(expiresInDays),
          countryCode: req.countryCode,
          createdBy: req.user._id
       });
       return res.status(201).json({ message: "Insurance codes generated ✅", ...result });
    } else {
       for (let i = 0; i < count; i++) {
          const code = `ADM-DRV-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
          const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
          const doc = await DriverVerificationCode.create({
            code,
            partnerId: id,
            expiresAt,
            createdBy: req.user._id
          });
          generated.push(doc);
       }
       return res.status(201).json({ message: "Driver verification codes generated ✅", codes: generated });
    }
  } catch (err) {
    return res.status(500).json({ message: "Generation failed", error: err.message });
  }
});

/**
 * ✅ Activate/Suspend Partner
 * LEGACY ROUTE - PROXY TO PATCH
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

    try {
      await partner.save();
    } catch (saveErr) {
       if (saveErr.code === 11000) {
          return res.status(409).json({ message: "Partner code or email already exists" });
       }
       throw saveErr;
    }
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

/**
 * ✅ Test SendGrid Integration
 * POST /api/admin/portal-control/test-email
 */
router.post("/test-email", auth, requireAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Recipient email is required" });

    const sent = await EmailService.send(req, {
       to: email,
       subject: "TowMech SendGrid Test Email",
       html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #FF8C00; border-radius: 10px;">
             <h2 style="color: #FF8C00;">SendGrid Integration Verified ✅</h2>
             <p>This is a test email from the TowMech Portal Control Center.</p>
             <p>Timestamp: <b>${new Date().toLocaleString()}</b></p>
             <p>If you received this, the SendGrid Email Engine is fully operational.</p>
             <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
             <p style="font-size: 12px; color: #999;">&copy; 2026 TowMech Single Control Plane.</p>
          </div>
       `,
       category: "test"
    });

    if (sent) {
       return res.status(200).json({ message: "Test email sent successfully via SendGrid! ✅" });
    } else {
       return res.status(500).json({ message: "Failed to send test email. Check server logs." });
    }
  } catch (err) {
    return res.status(500).json({ message: "Action failed", error: err.message });
  }
});

export default router;
