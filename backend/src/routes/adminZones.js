// backend/src/routes/adminZones.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import Zone from "../models/Zone.js";
import { USER_ROLES } from "../models/User.js";

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
 * ✅ GET all zones (PER COUNTRY WORKSPACE)
 * GET /api/admin/zones
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageZones")) return;

      const workspaceCountryCode = resolveCountryCode(req);

      const zones = await Zone.find({ countryCode: workspaceCountryCode }).sort({
        createdAt: -1,
      });

      return res.status(200).json({ countryCode: workspaceCountryCode, zones });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch zones ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ CREATE zone (PER COUNTRY WORKSPACE)
 * POST /api/admin/zones
 */
router.post(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageZones")) return;

      const workspaceCountryCode = resolveCountryCode(req);
      const { name, description, isActive } = req.body;

      if (!name) {
        return res.status(400).json({ message: "Zone name is required ❌" });
      }

      // ✅ uniqueness per country
      const exists = await Zone.findOne({
        countryCode: workspaceCountryCode,
        name: name.trim(),
      });

      if (exists) {
        return res.status(400).json({ message: "Zone already exists ❌" });
      }

      const zone = await Zone.create({
        name: name.trim(),
        description: description || "",
        isActive: isActive !== undefined ? isActive : true,
        createdBy: req.user._id,
        countryCode: workspaceCountryCode,
      });

      return res.status(201).json({
        message: "Zone created ✅",
        countryCode: workspaceCountryCode,
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
 * ✅ UPDATE zone (PER COUNTRY WORKSPACE)
 * PATCH /api/admin/zones/:id
 */
router.patch(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageZones")) return;

      const workspaceCountryCode = resolveCountryCode(req);
      const { name, description, isActive } = req.body;

      const zone = await Zone.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      });

      if (!zone) return res.status(404).json({ message: "Zone not found ❌" });

      if (name !== undefined) zone.name = String(name).trim();
      if (description !== undefined) zone.description = description;
      if (isActive !== undefined) zone.isActive = isActive;

      zone.updatedBy = req.user._id;

      await zone.save();

      return res.status(200).json({
        message: "Zone updated ✅",
        countryCode: workspaceCountryCode,
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
 * ✅ DELETE zone (PER COUNTRY WORKSPACE)
 * DELETE /api/admin/zones/:id
 */
router.delete(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageZones")) return;

      const workspaceCountryCode = resolveCountryCode(req);

      const zone = await Zone.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      });

      if (!zone) return res.status(404).json({ message: "Zone not found ❌" });

      await zone.deleteOne();

      return res.status(200).json({
        message: "Zone deleted ✅",
        countryCode: workspaceCountryCode,
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