// backend/src/routes/adminUsers.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import Rating from "../models/Rating.js";
import SupportTicket from "../models/SupportTicket.js";
import WeeklyPayout from "../models/WeeklyPayout.js";
import FinancialLog from "../models/FinancialLog.js";
import mongoose from "mongoose";

const router = express.Router();

/**
 * ✅ Resolve active workspace country (Tenant)
 */
const resolveCountryCode = (req) => {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.headers["X-COUNTRY-CODE"] ||
    req.query?.country ||
    req.query?.countryCode ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Block Suspended / Banned admins from doing actions
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
 * ✅ Enforce country workspace rules:
 * - SuperAdmin can view any workspace
 * - Admin can only view:
 *    - their own country workspace
 *    - OR any workspace IF canSwitchCountryWorkspace=true
 *
 * ✅ IMPORTANT: If admin cannot switch, FORCE workspaceCountryCode to userCountry.
 * This blocks any “header tampering”.
 */
const enforceWorkspaceAccess = (req, res, workspaceCountryCode) => {
  const role = req.user?.role;
  const userCountry = String(req.user?.countryCode || "ZA").toUpperCase();
  const canSwitch = !!req.user?.permissions?.canSwitchCountryWorkspace;

  // SuperAdmin can view any workspace
  if (role === USER_ROLES.SUPER_ADMIN) {
    req.countryCode = workspaceCountryCode;
    return true;
  }

  // Admin cannot switch unless explicitly allowed
  if (role === USER_ROLES.ADMIN && !canSwitch) {
    // 🔒 FORCE workspace to user's own country no matter what was requested
    req.countryCode = userCountry;
    return true;
  }

  // Admin with switch permission can access requested workspace
  req.countryCode = workspaceCountryCode;
  return true;
};

/**
 * ✅ Safe JSON helper
 */
const safeUser = (user, viewerRole) => {
  if (typeof user.toSafeJSON === "function") return user.toSafeJSON(viewerRole);
  const obj = user.toObject();
  delete obj.password;
  delete obj.otpCode;
  delete obj.otpExpiresAt;
  return obj;
};

/**
 * ✅ ADMIN / SUPERADMIN: Get all users (PER COUNTRY WORKSPACE)
 * GET /api/admin/users
 */
router.get(
  "/users",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers"),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const requestedCountryCode = resolveCountryCode(req);

      // ✅ will also set req.countryCode (forced if admin cannot switch)
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const { role, search, minRating, maxRating, page = 1, limit = 25 } = req.query;

      const query = {};
      if (blockRestrictedAdmins(req, res)) return; // double check

      // ✅ Rating Filter (Provider/Customer specific)
      if (minRating || maxRating) {
        const min = Number(minRating) || 0;
        const max = Number(maxRating) || 5;

        // If role is specified, we filter that specific ratingStat
        if (role === USER_ROLES.MECHANIC || role === USER_ROLES.TOW_TRUCK) {
          query["ratingStats.asProvider.avg"] = { $gte: min, $lte: max };
        } else if (role === USER_ROLES.CUSTOMER) {
          query["ratingStats.asCustomer.avg"] = { $gte: min, $lte: max };
        } else {
          // If no role, check if either matches (flexible)
          query.$or = [
            { "ratingStats.asProvider.avg": { $gte: min, $lte: max } },
            { "ratingStats.asCustomer.avg": { $gte: min, $lte: max } },
          ];
        }
      }

      // ✅ COUNTRY SCOPING:
      // - Always include global SuperAdmins if role filter is empty
      // - Otherwise keep everything inside workspaceCountryCode
      if (role) {
        query.role = role;
        if (String(role) !== USER_ROLES.SUPER_ADMIN) {
          query.countryCode = workspaceCountryCode;
        }
      } else {
        query.$or = [
          { role: USER_ROLES.SUPER_ADMIN }, // global
          { countryCode: workspaceCountryCode }, // everything else per country
        ];
      }

      if (search) {
        const s = String(search);
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { name: { $regex: s, $options: "i" } },
            { email: { $regex: s, $options: "i" } },
            { phone: { $regex: s, $options: "i" } },
          ],
        });
      }

      const skip = (Number(page) - 1) * Number(limit);

      const users = await User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      const total = await User.countDocuments(query);

      return res.status(200).json({
        success: true,
        countryCode: workspaceCountryCode,
        total,
        page: Number(page),
        limit: Number(limit),
        users: users.map((u) => safeUser(u, req.user.role)),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not fetch users", error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: Get single user profile
 * GET /api/admin/users/:id
 */
router.get(
  "/users/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers"),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const user = await User.findById(req.params.id).populate("partnerId", "name type partnerCode");
      if (!user) return res.status(404).json({ message: "User not found" });

      // ✅ Country isolation:
      if (
        user.role !== USER_ROLES.SUPER_ADMIN &&
        String(user.countryCode || "").toUpperCase() !== workspaceCountryCode &&
        req.user.role !== USER_ROLES.SUPER_ADMIN
      ) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = user._id;

      // --- 1. Aggregating Job Summary ---
      const jobStatsPromise = Job.aggregate([
        { $match: { $or: [{ customer: userId }, { assignedTo: userId }] } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", JOB_STATUSES.COMPLETED] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ["$status", JOB_STATUSES.CANCELLED] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ["$status", "REJECTED"] }, 1, 0] } }, // if applicable
            insurance: { $sum: { $cond: ["$insurance.enabled", 1, 0] } },
            cash: { $sum: { $cond: [{ $not: ["$insurance.enabled"] }, 1, 0] } },
            active: { $sum: { $cond: [{ $in: ["$status", [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS]] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $in: ["$status", [JOB_STATUSES.CREATED, JOB_STATUSES.BROADCASTED]] }, 1, 0] } },
          },
        },
      ]);

      // --- 2. Aggregating Rating Summary ---
      const ratingStatsPromise = Rating.aggregate([
        { $match: { target: userId } },
        {
          $group: {
            _id: null,
            average: { $avg: "$rating" },
            count: { $sum: 1 },
            star1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
            star2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
            star3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
            star4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
            star5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
          },
        },
      ]);

      // --- 3. Aggregating Financial Summary ---
      let financialStatsPromise;
      if (user.role === USER_ROLES.CUSTOMER) {
        financialStatsPromise = Job.aggregate([
          { $match: { customer: userId, status: JOB_STATUSES.COMPLETED } },
          {
            $group: {
              _id: null,
              totalSpent: { $sum: "$pricing.estimatedTotal" },
              insuranceCovered: { $sum: { $cond: ["$insurance.enabled", "$pricing.estimatedTotal", 0] } },
              cashPayments: { $sum: { $cond: [{ $not: ["$insurance.enabled"] }, "$pricing.estimatedTotal", 0] } },
            },
          },
        ]);
      } else {
        financialStatsPromise = Promise.all([
          Job.aggregate([
            { $match: { assignedTo: userId, status: JOB_STATUSES.COMPLETED } },
            {
              $group: {
                _id: null,
                lifetimeEarnings: { $sum: "$pricing.providerAmountDue" },
                insuranceEarnings: { $sum: { $cond: ["$insurance.enabled", "$pricing.providerAmountDue", 0] } },
                cashEarnings: { $sum: { $cond: [{ $not: ["$insurance.enabled"] }, "$pricing.providerAmountDue", 0] } },
              },
            }
          ]),
          WeeklyPayout.aggregate([
            { $match: { provider: userId } },
            {
              $group: {
                _id: null,
                totalPaid: { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, "$totalAmount", 0] } },
                totalPending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, "$totalAmount", 0] } },
              },
            }
          ])
        ]);
      }

      // --- 4. Support Tickets ---
      const supportStatsPromise = SupportTicket.aggregate([
        { $match: { createdBy: userId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            closed: { $sum: { $cond: [{ $in: ["$status", ["CLOSED", "RESOLVED"]] }, 1, 0] } },
            open: { $sum: { $cond: [{ $in: ["$status", ["OPEN", "IN_PROGRESS"]] }, 1, 0] } },
            lastTicketAt: { $max: "$createdAt" },
          },
        },
      ]);

      // --- 5. Audit History ---
      const auditLogsPromise = FinancialLog.find({
        $or: [
          { entityId: userId },
          { "details.userId": userId },
          { "details.driverId": userId }
        ]
      })
      .populate("performedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(50);

      const [jobStats, ratingStats, financialData, supportStats, auditLogs] = await Promise.all([
        jobStatsPromise,
        ratingStatsPromise,
        financialStatsPromise,
        supportStatsPromise,
        auditLogsPromise,
      ]);

      let processedFinancial = null;
      if (user.role === USER_ROLES.CUSTOMER) {
        processedFinancial = financialData[0] || { totalSpent: 0, insuranceCovered: 0, cashPayments: 0 };
      } else {
        const [jobFin, payoutData] = financialData;
        processedFinancial = {
          ...(jobFin[0] || { lifetimeEarnings: 0, insuranceEarnings: 0, cashEarnings: 0 }),
          paidPayouts: payoutData[0]?.totalPaid || 0,
          pendingPayouts: payoutData[0]?.totalPending || 0,
        };
      }

      return res.status(200).json({
        success: true,
        user: safeUser(user, req.user.role),
        intelligence: {
          jobStats: jobStats[0] || { total: 0, completed: 0, cancelled: 0, rejected: 0, insurance: 0, cash: 0, active: 0, pending: 0 },
          ratingStats: ratingStats[0] || { average: 0, count: 0, star1: 0, star2: 0, star3: 0, star4: 0, star5: 0 },
          financialStats: processedFinancial,
          supportStats: supportStats[0] || { total: 0, closed: 0, open: 0, lastTicketAt: null },
          auditLogs: auditLogs || [],
        },
      });
    } catch (err) {
      console.error("🔥 Intelligence aggregation failed:", err);
      return res
        .status(500)
        .json({ message: "Could not fetch enhanced user intelligence", error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: suspend a user
 * PATCH /api/admin/users/:id/suspend
 */
router.patch(
  "/users/:id/suspend",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers"),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const { reason } = req.body;

      if (req.user._id.toString() === req.params.id) {
        return res.status(403).json({ message: "You cannot suspend yourself ❌" });
      }

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

      // ✅ prevent admin affecting users from other countries (except SuperAdmin targets)
      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        target.role !== USER_ROLES.SUPER_ADMIN &&
        String(target.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "User not found" });
      }

      if (
        target.role === USER_ROLES.SUPER_ADMIN &&
        req.user.role !== USER_ROLES.SUPER_ADMIN
      ) {
        return res
          .status(403)
          .json({ message: "Only SuperAdmin can suspend SuperAdmin ❌" });
      }

      if (!target.accountStatus) target.accountStatus = {};
      target.accountStatus.isSuspended = true;
      target.accountStatus.suspendedAt = new Date();
      target.accountStatus.suspendedBy = req.user._id;
      target.accountStatus.suspendReason = reason || "Suspended by admin";

      await target.save();

      return res.status(200).json({
        success: true,
        message: "User suspended ✅",
        user: safeUser(target, req.user.role),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not suspend user", error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: unsuspend a user
 * PATCH /api/admin/users/:id/unsuspend
 */
router.patch(
  "/users/:id/unsuspend",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers"),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        target.role !== USER_ROLES.SUPER_ADMIN &&
        String(target.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!target.accountStatus) target.accountStatus = {};
      target.accountStatus.isSuspended = false;
      target.accountStatus.suspendedAt = null;
      target.accountStatus.suspendedBy = null;
      target.accountStatus.suspendReason = null;

      await target.save();

      return res.status(200).json({
        success: true,
        message: "User unsuspended ✅",
        user: safeUser(target, req.user.role),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not unsuspend user", error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: ban a user
 * PATCH /api/admin/users/:id/ban
 */
router.patch(
  "/users/:id/ban",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers"),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const { reason } = req.body;

      if (req.user._id.toString() === req.params.id) {
        return res.status(403).json({ message: "You cannot ban yourself ❌" });
      }

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        target.role !== USER_ROLES.SUPER_ADMIN &&
        String(target.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "User not found" });
      }

      if (
        target.role === USER_ROLES.SUPER_ADMIN &&
        req.user.role !== USER_ROLES.SUPER_ADMIN
      ) {
        return res
          .status(403)
          .json({ message: "Only SuperAdmin can ban SuperAdmin ❌" });
      }

      if (!target.accountStatus) target.accountStatus = {};
      target.accountStatus.isBanned = true;
      target.accountStatus.bannedAt = new Date();
      target.accountStatus.bannedBy = req.user._id;
      target.accountStatus.banReason = reason || "Banned by admin";

      await target.save();

      return res.status(200).json({
        success: true,
        message: "User banned ✅",
        user: safeUser(target, req.user.role),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not ban user", error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: unban a user
 * PATCH /api/admin/users/:id/unban
 */
router.patch(
  "/users/:id/unban",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers"),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        target.role !== USER_ROLES.SUPER_ADMIN &&
        String(target.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!target.accountStatus) target.accountStatus = {};
      target.accountStatus.isBanned = false;
      target.accountStatus.bannedAt = null;
      target.accountStatus.bannedBy = null;
      target.accountStatus.banReason = null;

      await target.save();

      return res.status(200).json({
        success: true,
        message: "User unbanned ✅",
        user: safeUser(target, req.user.role),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not unban user", error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: Unblock Device
 * POST /api/admin/users/unblock-device
 */
router.post(
  "/users/unblock-device",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers"),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId is required" });

      const target = await User.findById(userId);
      if (!target) return res.status(404).json({ message: "User not found" });

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;
      const workspaceCountryCode = req.countryCode;

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        target.role !== USER_ROLES.SUPER_ADMIN &&
        String(target.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "User not found" });
      }

      target.isDeviceBlocked = false;
      target.otpAttempts = 0;
      target.blockReason = null;
      target.blockExpiresAt = null;

      await target.save();

      // Audit log entry simulation
      console.log(`[AUDIT] DEVICE_UNBLOCK | User: ${target._id} | Admin: ${req.user._id} | Timestamp: ${new Date().toISOString()}`);

      return res.status(200).json({
        success: true,
        message: "Device unblocked and OTP counters reset successfully ✅",
        user: safeUser(target, req.user.role),
      });
    } catch (err) {
      return res.status(500).json({ message: "Could not unblock device", error: err.message });
    }
  }
);

/**
 * ✅ SUPERADMIN ONLY: archive a user
 * PATCH /api/admin/users/:id/archive
 */
router.patch(
  "/users/:id/archive",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      if (req.user._id.toString() === req.params.id) {
        return res.status(403).json({ message: "You cannot archive yourself ❌" });
      }

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

      if (!target.accountStatus) target.accountStatus = {};
      target.accountStatus.isArchived = true;
      target.accountStatus.archivedAt = new Date();
      target.accountStatus.archivedBy = req.user._id;

      await target.save();

      return res.status(200).json({
        success: true,
        message: "User archived ✅",
        user: safeUser(target, req.user.role),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not archive user", error: err.message });
    }
  }
);

/**
 * ✅ SUPERADMIN ONLY: unarchive a user
 * PATCH /api/admin/users/:id/unarchive
 */
router.patch(
  "/users/:id/unarchive",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

      if (!target.accountStatus) target.accountStatus = {};
      target.accountStatus.isArchived = false;
      target.accountStatus.archivedAt = null;
      target.accountStatus.archivedBy = null;

      await target.save();

      return res.status(200).json({
        success: true,
        message: "User unarchived ✅",
        user: safeUser(target, req.user.role),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not unarchive user", error: err.message });
    }
  }
);

export default router;