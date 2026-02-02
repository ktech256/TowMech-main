// backend/src/routes/adminOverview.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import SupportTicket from "../models/SupportTicket.js";

let ChatThread = null;
try {
  ChatThread = (await import("../models/ChatThread.js")).default;
} catch (_) {
  ChatThread = null;
}

const router = express.Router();

/**
 * ✅ Resolve active workspace country (Tenant)
 */
const resolveCountryCode = (req) => {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query?.country ||
    req.query?.countryCode ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Permission enforcement helper
 */
const requirePermission = (req, res, permissionKey) => {
  if (req.user.role === USER_ROLES.SUPER_ADMIN) return true;

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
 * ✅ GET OVERVIEW SUMMARY (PER COUNTRY WORKSPACE)
 * GET /api/admin/overview/summary
 */
router.get(
  "/summary",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canViewOverview")) return;

      const workspaceCountryCode = resolveCountryCode(req);

      // ✅ TOTAL USERS (CUSTOMERS ONLY) - per country
      const totalUsers = await User.countDocuments({
        role: USER_ROLES.CUSTOMER,
        countryCode: workspaceCountryCode,
      });

      // ✅ TOTAL PROVIDERS - per country
      const totalProviders = await User.countDocuments({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
      });

      // ✅ ACTIVE JOBS - per country
      const activeJobs = await Job.countDocuments({
        countryCode: workspaceCountryCode,
        status: {
          $in: [
            JOB_STATUSES.PENDING,
            JOB_STATUSES.CREATED,
            JOB_STATUSES.BROADCASTED,
            JOB_STATUSES.ASSIGNED,
            JOB_STATUSES.IN_PROGRESS,
          ],
        },
      });

      // ✅ PENDING PAYMENTS - per country
      const pendingPayments = await Payment.countDocuments({
        countryCode: workspaceCountryCode,
        status: PAYMENT_STATUSES.PENDING,
      });

      // ✅ OPEN SUPPORT TICKETS - per country
      const openSupportTickets = await SupportTicket.countDocuments({
        countryCode: workspaceCountryCode,
        status: "OPEN",
      });

      // ✅ LIVE PROVIDERS - per country
      const liveProviders = await User.countDocuments({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.lastLocationUpdate": {
          $gte: new Date(Date.now() - 10 * 60 * 1000),
        },
      });

      // ✅ TOTAL REVENUE - per country
      const revenueAgg = await Payment.aggregate([
        { $match: { countryCode: workspaceCountryCode, status: PAYMENT_STATUSES.PAID } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      const totalRevenue = revenueAgg?.[0]?.total || 0;

      // ✅ MOST USED SERVICES - per country
      const topServices = await Job.aggregate([
        {
          $match: {
            countryCode: workspaceCountryCode,
            serviceCategory: { $ne: null },
          },
        },
        { $group: { _id: "$serviceCategory", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]);

      // ✅ ACTIVE CHATS - per country (if model exists)
      let activeChats = 0;
      if (ChatThread) {
        activeChats = await ChatThread.countDocuments({
          countryCode: workspaceCountryCode,
          status: { $in: ["OPEN", "ACTIVE"] },
        }).catch(() => 0);
      }

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        users: totalUsers,
        providers: totalProviders,
        activeJobs,
        pendingPayments,
        openSupportTickets,
        liveProviders,
        revenueTotal: totalRevenue,
        topServices: topServices.map((s) => ({ name: s._id, count: s.count })),
        activeChats,
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