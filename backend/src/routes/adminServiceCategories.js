import express from "express";

import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";

import ServiceCategory from "../models/ServiceCategory.js";
import { USER_ROLES } from "../models/User.js";

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
 * ✅ Block Suspended / Banned admins
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
 * ✅ GET ALL SERVICE CATEGORIES
 * GET /api/admin/service-categories
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canManageServiceCategories")) return;

      const list = await ServiceCategory.find().sort({ createdAt: -1 });

      return res.status(200).json({ categories: list });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to load service categories",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ CREATE NEW SERVICE CATEGORY
 * POST /api/admin/service-categories
 */
router.post(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canManageServiceCategories")) return;

      const { name, description, providerType, basePrice, active } = req.body;

      if (!name || !providerType) {
        return res.status(400).json({
          message: "name and providerType are required ❌",
        });
      }

      const category = await ServiceCategory.create({
        name,
        description,
        providerType,
        basePrice: basePrice || 0,
        active: active !== undefined ? active : true,
        createdBy: req.user._id,
      });

      return res.status(201).json({
        message: "Service category created ✅",
        category,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to create service category",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ UPDATE CATEGORY
 * PATCH /api/admin/service-categories/:id
 */
router.patch(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canManageServiceCategories")) return;

      const updated = await ServiceCategory.findByIdAndUpdate(
        req.params.id,
        {
          ...req.body,
          updatedBy: req.user._id,
        },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({ message: "Category not found ❌" });
      }

      return res.status(200).json({
        message: "Service category updated ✅",
        category: updated,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to update service category",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ DELETE CATEGORY
 * DELETE /api/admin/service-categories/:id
 */
router.delete(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canManageServiceCategories")) return;

      const deleted = await ServiceCategory.findByIdAndDelete(req.params.id);

      if (!deleted) {
        return res.status(404).json({ message: "Category not found ❌" });
      }

      return res.status(200).json({
        message: "Service category deleted ✅",
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to delete service category",
        error: err.message,
      });
    }
  }
);

export default router;