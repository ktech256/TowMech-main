import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import SystemSettings from "../models/SystemSettings.js";

const router = express.Router();

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
 * ✅ Get current settings
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

      // ✅ Create default settings on first run
      if (!settings) {
        settings = await SystemSettings.create({
          enableTowTrucks: true,
          enableMechanics: true,
          forceUpdateVersion: "",
          terms: "",
          privacyPolicy: "",
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
 * ✅ Update system settings
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

      if (!settings) {
        settings = await SystemSettings.create({});
      }

      const {
        enableTowTrucks,
        enableMechanics,
        forceUpdateVersion,
        terms,
        privacyPolicy,
        zones,
      } = req.body;

      if (enableTowTrucks !== undefined) settings.enableTowTrucks = enableTowTrucks;
      if (enableMechanics !== undefined) settings.enableMechanics = enableMechanics;

      if (forceUpdateVersion !== undefined) settings.forceUpdateVersion = forceUpdateVersion;

      if (terms !== undefined) settings.terms = terms;
      if (privacyPolicy !== undefined) settings.privacyPolicy = privacyPolicy;

      if (zones !== undefined) settings.zones = zones;

      settings.updatedBy = req.user._id;

      await settings.save();

      return res.status(200).json({
        message: "System settings updated ✅",
        settings,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to update system settings ❌",
        error: err.message,
      });
    }
  }
);

export default router;
