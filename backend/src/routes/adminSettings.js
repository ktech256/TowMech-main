import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import SystemSettings from "../models/SystemSettings.js";

const router = express.Router();

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
 * ✅ GET system settings
 * GET /api/admin/settings
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageSettings")) return;

      let settings = await SystemSettings.findOne();

      if (!settings) {
        settings = await SystemSettings.create({
          updatedBy: req.user._id,
        });
      }

      return res.status(200).json({ settings });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch system settings ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ UPDATE system settings
 * PATCH /api/admin/settings
 */
router.patch(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageSettings")) return;

      let settings = await SystemSettings.findOne();
      if (!settings) settings = new SystemSettings();

      const payload = req.body;

      // ✅ merge safe
      Object.assign(settings, payload);
      settings.updatedBy = req.user._id;

      await settings.save();

      return res.status(200).json({
        message: "System settings updated ✅",
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