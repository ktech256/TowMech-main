// backend/src/routes/superAdmin.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";

const router = express.Router();

function normalizePhone(phone) {
  if (!phone) return "";
  let p = String(phone).trim();
  p = p.replace(/\s+/g, "");
  p = p.replace(/[-()]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  return p;
}

function resolveCountryCode(req) {
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
}

router.get("/test", (req, res) => {
  return res.status(200).json({ message: "SuperAdmin route working ✅" });
});

router.post(
  "/create-admin",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { name, email, password, role, permissions, phone } = req.body;

      if (!name || !email || !password || !phone) {
        return res.status(400).json({
          message: "name, email, password, phone are required",
        });
      }

      const normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) {
        return res.status(400).json({ message: "Invalid phone provided ❌" });
      }

      const emailLower = String(email).trim().toLowerCase();
      const workspaceCountryCode = resolveCountryCode(req);

      const exists = await User.findOne({
        $or: [{ email: emailLower }, { phone: normalizedPhone }],
      });

      if (exists) {
        if (exists.email === emailLower) {
          return res.status(409).json({ message: "Email already exists ❌" });
        }
        if (exists.phone === normalizedPhone) {
          return res.status(409).json({ message: "Phone already exists ❌" });
        }
        return res.status(409).json({ message: "User already exists ❌" });
      }

      const chosenRole =
        role === "SuperAdmin" ? USER_ROLES.SUPER_ADMIN : USER_ROLES.ADMIN;

      const defaultPermissions = {
        canManageUsers: true,
        canManagePricing: true,
        canViewStats: true,
        canVerifyProviders: true,
      };

      const creator = await User.findById(req.user._id);
      if (!creator) {
        return res.status(403).json({ message: "Invalid creator account ❌" });
      }

      const firstName = name.split(" ")[0] || name;
      const lastName = name.split(" ").slice(1).join(" ") || "Admin";

      const admin = new User({
        name,
        email: emailLower,
        password,
        role: chosenRole,
        permissions: permissions || defaultPermissions,
        firstName,
        lastName,
        phone: normalizedPhone,

        // ✅ bind Admins to workspace country
        countryCode: workspaceCountryCode,

        birthday: creator.birthday || new Date("1990-01-01"),
        nationalityType: creator.nationalityType || "ForeignNational",
        saIdNumber: creator.saIdNumber || null,
        passportNumber: creator.passportNumber || null,
        country: creator.country || "Other",
      });

      await admin.save();

      return res.status(201).json({
        message: `${chosenRole} created successfully ✅`,
        workspaceCountryCode,
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

router.get(
  "/admins",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);

      const admins = await User.find({
        $or: [
          { role: USER_ROLES.SUPER_ADMIN },
          { role: USER_ROLES.ADMIN, countryCode: workspaceCountryCode },
        ],
      }).sort({ createdAt: -1 });

      return res.status(200).json({
        workspaceCountryCode,
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

router.patch(
  "/admin/:id/archive",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const admin = await User.findById(req.params.id);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

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