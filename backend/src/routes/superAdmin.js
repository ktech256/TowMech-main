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
          message: "name, email, password are required",
        });
      }

      const exists = await User.findOne({ email });
      if (exists) {
        return res.status(409).json({ message: "User already exists ❌" });
      }

      // ✅ Allow creating both Admin and SuperAdmin
      const chosenRole =
        role === "SuperAdmin" ? USER_ROLES.SUPER_ADMIN : USER_ROLES.ADMIN;

      // ✅ Default permissions if none supplied
      const defaultPermissions = {
        canManageUsers: true,
        canManagePricing: true,
        canViewStats: true,
        canVerifyProviders: true,
      };

      // ✅ IMPORTANT: Your User model requires fields like firstName, lastName, phone, birthday, nationalityType
      // ✅ So we auto-fill safe defaults so admin creation NEVER fails.
      const admin = await User.create({
        name,
        email,
        password,
        role: chosenRole,
        permissions: permissions || defaultPermissions,

        // ✅ REQUIRED USER MODEL FIELDS (AUTO DEFAULTS)
        firstName: name.split(" ")[0] || name,
        lastName: name.split(" ").slice(1).join(" ") || "Admin",
        phone: "0000000000",
        birthday: new Date("1990-01-01"),
        nationalityType: "OTHER",
      });

      return res.status(201).json({
        message: `${chosenRole} created successfully ✅`,
        admin: admin.toSafeJSON(USER_ROLES.SUPER_ADMIN),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not create admin",
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
      const admin = await User.findById(req.params.id);

      if (!admin) return res.status(404).json({ message: "Admin not found" });

      // ✅ allow editing both Admin + SuperAdmin
      if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(admin.role)) {
        return res
          .status(400)
          .json({ message: "Target user must be Admin or SuperAdmin ❌" });
      }

      admin.permissions = {
        ...admin.permissions,
        ...(req.body.permissions || req.body),
      };

      await admin.save();

      return res.status(200).json({
        message: "Permissions updated ✅",
        admin: admin.toSafeJSON(USER_ROLES.SUPER_ADMIN),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not update permissions",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ SuperAdmin fetches all admins
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
        admins: admins.map((a) => a.toSafeJSON(USER_ROLES.SUPER_ADMIN)),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch admins",
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

      if (!admin) return res.status(404).json({ message: "Admin not found" });

      // ✅ Must be Admin only (prevent archiving SuperAdmin)
      if (admin.role !== USER_ROLES.ADMIN) {
        return res
          .status(400)
          .json({ message: "Only Admin accounts can be archived ❌" });
      }

      // ✅ Prevent archiving self
      if (admin._id.toString() === req.user._id.toString()) {
        return res
          .status(400)
          .json({ message: "You cannot archive your own account ❌" });
      }

      if (!admin.accountStatus) admin.accountStatus = {};

      admin.accountStatus.isArchived = true;
      admin.accountStatus.archivedAt = new Date();
      admin.accountStatus.archivedBy = req.user._id;

      await admin.save();

      return res.status(200).json({
        message: "Admin archived ✅",
        admin: admin.toSafeJSON(USER_ROLES.SUPER_ADMIN),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not archive admin",
        error: err.message,
      });
    }
  }
);

export default router;