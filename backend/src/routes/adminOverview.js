import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import SupportTicket from "../models/SupportTicket.js";

const router = express.Router();

/**
 * ✅ Permission enforcement helper
 */
const requirePermission = (req, res, permissionKey) => {
  // ✅ SuperAdmin bypass
  if (req.user.role === USER_ROLES.SUPER_ADMIN) return true;

  // ✅ Admin must have required permission
  if (req.user.role === USER_ROLES.ADMIN) {
    if (!req.user.permissions || req.user.permissions[permissionKey] !== true) {
      res.status(403).json({
        message: `Permission denied ❌ Missing ${permissionKey}`,
      });
      return false;
    }
    return true;
  }

  res.status(403).json({ message: "Permission denied ❌" });
  return false;
};

/**
 * ✅ GET OVERVIEW SUMMARY
 * GET /api/admin/overview/summary
 */
router.get(
  "/summary",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canViewOverview")) return;

      // ✅ TOTAL USERS (CUSTOMERS ONLY)
      const totalUsers = await User.countDocuments({ role: USER_ROLES.CUSTOMER });

      // ✅ TOTAL PROVIDERS
      const totalProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
      });

      // ✅ ACTIVE JOBS
      const activeJobs = await Job.countDocuments({
        status: { $in: [JOB_STATUSES.PENDING, JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] },
      });

      // ✅ PENDING PAYMENTS
      const pendingPayments = await Payment.countDocuments({
        status: PAYMENT_STATUSES.PENDING,
      });

      // ✅ OPEN SUPPORT TICKETS
      const openSupportTickets = await SupportTicket.countDocuments({
        status: "OPEN",
      });

      // ✅ LIVE PROVIDERS COUNT (those who have updated location recently)
      const liveProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.lastLocationUpdate": { $gte: new Date(Date.now() - 10 * 60 * 1000) }, // last 10 mins
      });

      // ✅ TOTAL REVENUE
      const revenueAgg = await Payment.aggregate([
        { $match: { status: PAYMENT_STATUSES.PAID } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const totalRevenue = revenueAgg?.[0]?.total || 0;

      // ✅ MOST USED SERVICES (from Job.serviceCategory)
      const topServices = await Job.aggregate([
        { $match: { serviceCategory: { $ne: null } } },
        {
          $group: {
            _id: "$serviceCategory",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]);

      return res.status(200).json({
        users: totalUsers,
        providers: totalProviders,
        activeJobs,
        pendingPayments,
        openSupportTickets,
        liveProviders,
        revenueTotal: totalRevenue,
        topServices: topServices.map((s) => ({
          name: s._id,
          count: s.count,
        })),
      });
    } catch (err) {
      console.error("❌ OVERVIEW ERROR:", err);
      return res.status(500).json({
        message: "Failed to load overview dashboard ❌",
        error: err.message,
      });
    }
  }
);

export default router;