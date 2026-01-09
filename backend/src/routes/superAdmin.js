import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ TEST route
 * GET /api/superadmin/test
 */
router.get("/test", (req, res) => {
  return res.status(200).json({ message: "SuperAdmin route working ✅" });
});

/**
 * ✅ SuperAdmin creates new Admin OR SuperAdmin (with permissions)
 * POST /api/superadmin/create-admin
 */
router.post(
  "/create-admin",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { name, email, password, role, permissions } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message: "name, email, password are required ❌",
        });
      }

      // ✅ Ensure role is valid
      const chosenRole =
        role === "SuperAdmin" || role === USER_ROLES.SUPER_ADMIN
          ? USER_ROLES.SUPER_ADMIN
          : USER_ROLES.ADMIN;

      const exists = await User.findOne({ email });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: "User already exists ❌",
        });
      }

      // ✅ Default permissions
      const defaultPermissions = {
        canViewOverview: true,
        canManageUsers: true,
        canManagePricing: true,
        canVerifyProviders: true,
        canApprovePayments: true,
        canRefundPayments: true,
        canManageJobs: true,
        canBroadcastNotifications: true,
        canManageSafety: true,
        canManageSettings: true,
        canManageZones: true,
        canManageServiceCategories: true,
        canViewAnalytics: true,
      };

      const admin = await User.create({
        name,
        email,
        password,
        role: chosenRole,
        permissions: permissions || defaultPermissions,
      });

      return res.status(201).json({
        success: true,
        message: `${chosenRole} created successfully ✅`,
        admin: admin.toSafeJSON(USER_ROLES.SUPER_ADMIN),
      });
    } catch (err) {
      console.error("❌ CREATE ADMIN ERROR:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "Could not create admin ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ SuperAdmin updates Admin permissions
 * PATCH /api/superadmin/admin/:id/permissions
 */
router.patch(
  "/admin/:id/permissions",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { permissions } = req.body;

      if (!permissions || typeof permissions !== "object") {
        return res.status(400).json({
          success: false,
          message: "permissions object is required ❌",
        });
      }

      const admin = await User.findById(req.params.id);

      if (!admin)
        return res.status(404).json({ success: false, message: "Admin not found ❌" });

      // ✅ allow updating Admin or SuperAdmin
      if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(admin.role)) {
        return res.status(400).json({
          success: false,
          message: "Target user is not an Admin or SuperAdmin ❌",
        });
      }

      admin.permissions = {
        ...(admin.permissions || {}),
        ...permissions,
      };

      await admin.save();

      return res.status(200).json({
        success: true,
        message: "Permissions updated ✅",
        admin: admin.toSafeJSON(USER_ROLES.SUPER_ADMIN),
      });
    } catch (err) {
      console.error("❌ UPDATE PERMISSIONS ERROR:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "Could not update permissions ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ SuperAdmin fetches all admins + superadmins
 * GET /api/superadmin/admins
 */
router.get(
  "/admins",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const admins = await User.find({
        role: { $in: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
      }).sort({ createdAt: -1 });

      return res.status(200).json({
        success: true,
        admins: admins.map((a) => a.toSafeJSON(USER_ROLES.SUPER_ADMIN)),
      });
    } catch (err) {
      console.error("❌ FETCH ADMINS ERROR:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "Could not fetch admins ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ SuperAdmin archives an admin
 * PATCH /api/superadmin/admin/:id/archive
 */
router.patch(
  "/admin/:id/archive",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const admin = await User.findById(req.params.id);

      if (!admin)
        return res.status(404).json({ success: false, message: "Admin not found ❌" });

      // ✅ Must be Admin only (SuperAdmin cannot be archived)
      if (admin.role !== USER_ROLES.ADMIN) {
        return res.status(400).json({
          success: false,
          message: "Only Admin accounts can be archived ❌",
        });
      }

      // ✅ Prevent archiving self
      if (admin._id.toString() === req.user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: "You cannot archive your own account ❌",
        });
      }

      if (!admin.accountStatus) admin.accountStatus = {};

      admin.accountStatus.isArchived = true;
      admin.accountStatus.archivedAt = new Date();
      admin.accountStatus.archivedBy = req.user._id;

      await admin.save();

      return res.status(200).json({
        success: true,
        message: "Admin archived ✅",
        admin: admin.toSafeJSON(USER_ROLES.SUPER_ADMIN),
      });
    } catch (err) {
      console.error("❌ ARCHIVE ADMIN ERROR:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "Could not archive admin ❌",
        error: err.message,
      });
    }
  }
);

export default router;