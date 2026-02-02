// backend/src/routes/adminSettings.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import SystemSettings from "../models/SystemSettings.js";

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
 * ✅ GET system settings (PER COUNTRY WORKSPACE)
 * GET /api/admin/settings
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageSettings")) return;

      const workspaceCountryCode = resolveCountryCode(req);

      // ✅ Per-country settings doc (keeps existing behavior if you already had only one doc)
      let settings = await SystemSettings.findOne({ countryCode: workspaceCountryCode });

      if (!settings) {
        settings = await SystemSettings.create({
          countryCode: workspaceCountryCode,
          updatedBy: req.user._id,
        });
      }

      return res.status(200).json({ countryCode: workspaceCountryCode, settings });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch system settings ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ UPDATE system settings (PER COUNTRY WORKSPACE)
 * PATCH /api/admin/settings
 */
router.patch(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageSettings")) return;

      const workspaceCountryCode = resolveCountryCode(req);

      let settings = await SystemSettings.findOne({ countryCode: workspaceCountryCode });
      if (!settings) settings = new SystemSettings({ countryCode: workspaceCountryCode });

      const payload = req.body && typeof req.body === "object" ? req.body : {};

      Object.assign(settings, payload);
      settings.countryCode = workspaceCountryCode;
      settings.updatedBy = req.user._id;

      await settings.save();

      return res.status(200).json({
        message: "System settings updated ✅",
        countryCode: workspaceCountryCode,
        settings,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to update settings ❌",
        error: err.message,
      });
    }
  }
);

export default router;