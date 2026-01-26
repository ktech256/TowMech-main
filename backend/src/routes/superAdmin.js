import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ Normalize phone for consistent login + uniqueness
 */
function normalizePhone(phone) {
  if (!phone) return "";
  let p = String(phone).trim();

  p = p.replace(/\s+/g, "");
  p = p.replace(/[-()]/g, "");

  // If someone sends "00.." convert to +..
  if (p.startsWith("00")) p = "+" + p.slice(2);

  return p;
}

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
      const { name, email, password, role, permissions, phone } = req.body;

      // ✅ phone is REQUIRED because login uses phone + phone has unique index
      if (!name || !email || !password || !phone) {
        return res.status(400).json({
          message: "name, email, password, phone are required",
        });
      }

      const normalizedPhone = normalizePhone(phone);

      if (!normalizedPhone) {
        return res.status(400).json({ message: "Invalid phone provided ❌" });
      }

      // ✅ Check if user exists by email OR phone
      const exists = await User.findOne({
        $or: [{ email }, { phone: normalizedPhone }],
      });

      if (exists) {
        // try to help with a clearer message
        if (exists.email === email) {
          return res.status(409).json({ message: "Email already exists ❌" });
        }
        if (exists.phone === normalizedPhone) {
          return res.status(409).json({ message: "Phone already exists ❌" });
        }
        return res.status(409).json({ message: "User already exists ❌" });
      }

      // ✅ Allow Admin or SuperAdmin creation
      const chosenRole =
        role === "SuperAdmin" ? USER_ROLES.SUPER_ADMIN : USER_ROLES.ADMIN;

      // ✅ Default permissions if none supplied
      const defaultPermissions = {
        canManageUsers: true,
        canManagePricing: true,
        canViewStats: true,
        canVerifyProviders: true,
      };

      // ✅ Use same required fields pattern as current logged-in SuperAdmin
      const creator = await User.findById(req.user._id);

      if (!creator) {
        return res.status(403).json({ message: "Invalid creator account ❌" });
      }

      const firstName = name.split(" ")[0] || name;
      const lastName = name.split(" ").slice(1).join(" ") || "Admin";

      const admin = new User({
        name,
        email,
        password,
        role: chosenRole,
        permissions: permissions || defaultPermissions,

        // ✅ REQUIRED FIELDS:
        firstName,
        lastName,

        // ✅ FIX: unique phone per admin (required for phone-login)
        phone: normalizedPhone,

        // keep your “copy required fields” fallback logic
        birthday: creator.birthday || new Date("1990-01-01"),
        nationalityType: creator.nationalityType || "ForeignNational",
        saIdNumber: creator.saIdNumber || null,
        passportNumber: creator.passportNumber || null,
        country: creator.country || "Other",
      });

      await admin.save();

      return res.status(201).json({
        message: `${chosenRole} created successfully ✅`,
        admin: admin.toSafeJSON(USER_ROLES.SUPER_ADMIN),
      });
    } catch (err) {
      console.log("❌ CREATE ADMIN ERROR:", err);

      return res.status(500).json({
        message: err.message || "Could not create admin",
        error: err?.errors || err,
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

      if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(admin.role)) {
        return res
          .status(400)
          .json({ message: "Target user is not Admin/SuperAdmin ❌" });
      }

      const incomingPermissions = req.body.permissions || {};

      admin.permissions = {
        ...admin.permissions,
        ...incomingPermissions,
      };

      await admin.save();

      return res.status(200).json({
        message: "Permissions updated ✅",
        admin: admin.toSafeJSON(USER_ROLES.SUPER_ADMIN),
      });
    } catch (err) {
      console.log("❌ UPDATE PERMISSIONS ERROR:", err);

      return res.status(500).json({
        message: err.message || "Could not update permissions",
        error: err?.errors || err,
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
      console.log("❌ FETCH ADMINS ERROR:", err);

      return res.status(500).json({
        message: err.message || "Could not fetch admins",
        error: err?.errors || err,
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
      console.log("❌ ARCHIVE ERROR:", err);

      return res.status(500).json({
        message: err.message || "Could not archive admin",
        error: err?.errors || err,
      });
    }
  }
);

export default router;