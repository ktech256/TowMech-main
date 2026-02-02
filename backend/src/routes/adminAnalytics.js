// backend/src/routes/adminAnalytics.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";

import Job, { JOB_STATUSES } from "../models/Job.js";
import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import User, { USER_ROLES } from "../models/User.js";

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
    req.body?.countryCode ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Permission helper
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
 * ✅ Block restricted admins
 */
const blockRestrictedAdmins = (req, res) => {
  if (req.user.accountStatus?.isSuspended) {
    res.status(403).json({ message: "Your admin account is suspended ❌" });
    return true;
  }

  if (req.user.accountStatus?.isBanned) {
    res.status(403).json({ message: "Your admin account is banned ❌" });
    return true;
  }

  return false;
};

/**
 * ✅ Date helper
 */
const getRange = () => {
  const now = new Date();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  startOfMonth.setHours(0, 0, 0, 0);

  return { now, startOfToday, startOfWeek, startOfMonth };
};

/**
 * ✅ ADMIN ANALYTICS SUMMARY (PER COUNTRY WORKSPACE)
 * GET /api/admin/analytics/summary
 */
router.get(
  "/summary",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canViewAnalytics")) return;

      const workspaceCountryCode = resolveCountryCode(req);
      const { now, startOfToday, startOfWeek, startOfMonth } = getRange();

      /**
       * ✅ BUSINESS METRICS (scoped by countryCode)
       */
      const totalRevenueAgg = await Payment.aggregate([
        { $match: { countryCode: workspaceCountryCode, status: PAYMENT_STATUSES.PAID } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const todayRevenueAgg = await Payment.aggregate([
        {
          $match: {
            countryCode: workspaceCountryCode,
            status: PAYMENT_STATUSES.PAID,
            createdAt: { $gte: startOfToday },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const weekRevenueAgg = await Payment.aggregate([
        {
          $match: {
            countryCode: workspaceCountryCode,
            status: PAYMENT_STATUSES.PAID,
            createdAt: { $gte: startOfWeek },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const monthRevenueAgg = await Payment.aggregate([
        {
          $match: {
            countryCode: workspaceCountryCode,
            status: PAYMENT_STATUSES.PAID,
            createdAt: { $gte: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const totalRevenue = totalRevenueAgg?.[0]?.total || 0;
      const revenueToday = todayRevenueAgg?.[0]?.total || 0;
      const revenueWeek = weekRevenueAgg?.[0]?.total || 0;
      const revenueMonth = monthRevenueAgg?.[0]?.total || 0;

      const paymentsPaid = await Payment.countDocuments({
        countryCode: workspaceCountryCode,
        status: PAYMENT_STATUSES.PAID,
      });

      const paymentsPending = await Payment.countDocuments({
        countryCode: workspaceCountryCode,
        status: PAYMENT_STATUSES.PENDING,
      });

      const paymentsRefunded = await Payment.countDocuments({
        countryCode: workspaceCountryCode,
        status: PAYMENT_STATUSES.REFUNDED,
      });

      const totalJobs = await Job.countDocuments({ countryCode: workspaceCountryCode });
      const jobsToday = await Job.countDocuments({
        countryCode: workspaceCountryCode,
        createdAt: { $gte: startOfToday },
      });
      const jobsWeek = await Job.countDocuments({
        countryCode: workspaceCountryCode,
        createdAt: { $gte: startOfWeek },
      });
      const jobsMonth = await Job.countDocuments({
        countryCode: workspaceCountryCode,
        createdAt: { $gte: startOfMonth },
      });

      const jobsCompleted = await Job.countDocuments({
        countryCode: workspaceCountryCode,
        status: JOB_STATUSES.COMPLETED,
      });

      const jobsCancelled = await Job.countDocuments({
        countryCode: workspaceCountryCode,
        status: JOB_STATUSES.CANCELLED,
      });

      /**
       * ✅ OPERATIONAL METRICS (scoped by countryCode)
       */
      const totalCustomers = await User.countDocuments({
        countryCode: workspaceCountryCode,
        role: USER_ROLES.CUSTOMER,
      });

      const totalProviders = await User.countDocuments({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
      });

      const onlineProviders = await User.countDocuments({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.isOnline": true,
      });

      const suspendedProviders = await User.countDocuments({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "accountStatus.isSuspended": true,
      });

      const pendingVerificationProviders = await User.countDocuments({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": { $ne: "APPROVED" },
      });

      /**
       * ✅ Job status breakdown (scoped)
       */
      const jobsByStatusAgg = await Job.aggregate([
        { $match: { countryCode: workspaceCountryCode } },
        { $group: { _id: "$status", total: { $sum: 1 } } },
      ]);

      const jobsByStatus = jobsByStatusAgg.reduce((acc, row) => {
        acc[row._id] = row.total;
        return acc;
      }, {});

      /**
       * ✅ Average completion time (scoped)
       */
      const completedJobs = await Job.find({
        countryCode: workspaceCountryCode,
        status: JOB_STATUSES.COMPLETED,
      })
        .select("createdAt updatedAt")
        .limit(200);

      let avgCompletionMinutes = 0;

      if (completedJobs.length > 0) {
        const totalMinutes = completedJobs.reduce((sum, j) => {
          const diff =
            new Date(j.updatedAt).getTime() - new Date(j.createdAt).getTime();
          return sum + diff / 60000;
        }, 0);

        avgCompletionMinutes = Math.round(totalMinutes / completedJobs.length);
      }

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        currency: "ZAR",
        generatedAt: now,

        business: {
          revenue: {
            totalRevenue,
            revenueToday,
            revenueWeek,
            revenueMonth,
          },
          payments: {
            paymentsPaid,
            paymentsPending,
            paymentsRefunded,
          },
          jobs: {
            totalJobs,
            jobsToday,
            jobsWeek,
            jobsMonth,
            jobsCompleted,
            jobsCancelled,
          },
        },

        operations: {
          users: {
            totalCustomers,
            totalProviders,
          },
          providers: {
            onlineProviders,
            suspendedProviders,
            pendingVerificationProviders,
          },
          jobsByStatus,
          avgCompletionMinutes,
        },
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch analytics summary ❌",
        error: err.message,
      });
    }
  }
);

export default router;