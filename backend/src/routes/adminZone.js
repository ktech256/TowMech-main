import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import Zone from "../models/Zone.js";
import User, { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ Permission enforcement helper
 */
const requirePermission = (req, res, permissionKey) => {
  // ✅ SuperAdmin bypass
  if (req.user.role === USER_ROLES.SUPER_ADMIN) return true;

  // ✅ Admin must have required permission
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
 * ✅ GET all zones
 * GET /api/admin/zones
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageZones")) return;

      const zones = await Zone.find().sort({ createdAt: -1 });

      return res.status(200).json({ zones });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch zones ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ CREATE zone
 * POST /api/admin/zones
 */
router.post(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageZones")) return;

      const { name, description, isActive } = req.body;

      if (!name) {
        return res.status(400).json({ message: "Zone name is required ❌" });
      }

      const exists = await Zone.findOne({ name: name.trim() });

      if (exists) {
        return res.status(400).json({ message: "Zone already exists ❌" });
      }

      const zone = await Zone.create({
        name: name.trim(),
        description: description || "",
        isActive: isActive !== undefined ? isActive : true,
        createdBy: req.user._id,
      });

      return res.status(201).json({
        message: "Zone created ✅",
        zone,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to create zone ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ UPDATE zone
 * PATCH /api/admin/zones/:id
 */
router.patch(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageZones")) return;

      const { name, description, isActive } = req.body;

      const zone = await Zone.findById(req.params.id);

      if (!zone) return res.status(404).json({ message: "Zone not found ❌" });

      if (name !== undefined) zone.name = name.trim();
      if (description !== undefined) zone.description = description;
      if (isActive !== undefined) zone.isActive = isActive;

      zone.updatedBy = req.user._id;

      await zone.save();

      return res.status(200).json({
        message: "Zone updated ✅",
        zone,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to update zone ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ DELETE zone
 * DELETE /api/admin/zones/:id
 */
router.delete(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageZones")) return;

      const zone = await Zone.findById(req.params.id);

      if (!zone) return res.status(404).json({ message: "Zone not found ❌" });

      await zone.deleteOne();

      return res.status(200).json({
        message: "Zone deleted ✅",
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to delete zone ❌",
        error: err.message,
      });
    }
  }
);

export default router;