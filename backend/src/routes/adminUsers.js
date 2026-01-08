import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";

const router = express.Router();

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
 * ✅ Safe JSON helper (fallback if toSafeJSON missing)
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
 * ✅ ADMIN / SUPERADMIN: Get all users
 * GET /api/admin/users
 *
 * Supports filters:
 * - role=Customer | TowTruck | Mechanic | Admin | SuperAdmin
 * - search=email or name keyword
 * - page + limit
 */
router.get(
  "/users",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers"),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;

      const { role, search, page = 1, limit = 25 } = req.query;

      const query = {};

      if (role) query.role = role;

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } }
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);

      const users = await User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      const total = await User.countDocuments(query);

      return res.status(200).json({
        success: true,
        total,
        page: Number(page),
        limit: Number(limit),
        users: users.map((u) => safeUser(u, req.user.role))
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

      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      return res.status(200).json({
        success: true,
        user: safeUser(user, req.user.role)
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not fetch user", error: err.message });
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

      const { reason } = req.body;

      if (req.user._id.toString() === req.params.id) {
        return res.status(403).json({ message: "You cannot suspend yourself ❌" });
      }

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

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
        user: safeUser(target, req.user.role)
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

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

      if (!target.accountStatus) target.accountStatus = {};

      target.accountStatus.isSuspended = false;
      target.accountStatus.suspendedAt = null;
      target.accountStatus.suspendedBy = null;
      target.accountStatus.suspendReason = null;

      await target.save();

      return res.status(200).json({
        success: true,
        message: "User unsuspended ✅",
        user: safeUser(target, req.user.role)
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

      const { reason } = req.body;

      if (req.user._id.toString() === req.params.id) {
        return res.status(403).json({ message: "You cannot ban yourself ❌" });
      }

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

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
        user: safeUser(target, req.user.role)
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

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: "User not found" });

      if (!target.accountStatus) target.accountStatus = {};

      target.accountStatus.isBanned = false;
      target.accountStatus.bannedAt = null;
      target.accountStatus.bannedBy = null;
      target.accountStatus.banReason = null;

      await target.save();

      return res.status(200).json({
        success: true,
        message: "User unbanned ✅",
        user: safeUser(target, req.user.role)
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not unban user", error: err.message });
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
        user: safeUser(target, req.user.role)
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
        user: safeUser(target, req.user.role)
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Could not unarchive user", error: err.message });
    }
  }
);

export default router;