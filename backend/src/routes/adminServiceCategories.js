// backend/src/routes/adminServiceCategories.js
import express from "express";

import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";

import ServiceCategory from "../models/ServiceCategory.js";
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
 * ✅ GET ALL SERVICE CATEGORIES (PER COUNTRY WORKSPACE)
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

      const workspaceCountryCode = resolveCountryCode(req);

      const list = await ServiceCategory.find({
        countryCode: workspaceCountryCode,
      }).sort({ createdAt: -1 });

      return res.status(200).json({ countryCode: workspaceCountryCode, categories: list });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to load service categories",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ CREATE NEW SERVICE CATEGORY (PER COUNTRY WORKSPACE)
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

      const workspaceCountryCode = resolveCountryCode(req);
      const { name, description, providerType, basePrice, active } = req.body;

      if (!name || !providerType) {
        return res.status(400).json({
          message: "name and providerType are required ❌",
        });
      }

      // ✅ Optional: prevent duplicates per country + providerType + name
      const exists = await ServiceCategory.findOne({
        countryCode: workspaceCountryCode,
        providerType,
        name,
      });

      if (exists) {
        return res.status(409).json({ message: "Service category already exists ❌" });
      }

      const category = await ServiceCategory.create({
        name,
        description,
        providerType,
        basePrice: basePrice || 0,
        active: active !== undefined ? active : true,
        createdBy: req.user._id,
        countryCode: workspaceCountryCode,
      });

      return res.status(201).json({
        message: "Service category created ✅",
        countryCode: workspaceCountryCode,
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
 * ✅ UPDATE CATEGORY (PER COUNTRY WORKSPACE)
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

      const workspaceCountryCode = resolveCountryCode(req);

      // ✅ ensure you only update within workspace country
      const updated = await ServiceCategory.findOneAndUpdate(
        { _id: req.params.id, countryCode: workspaceCountryCode },
        { ...req.body, updatedBy: req.user._id },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({ message: "Category not found ❌" });
      }

      return res.status(200).json({
        message: "Service category updated ✅",
        countryCode: workspaceCountryCode,
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
 * ✅ DELETE CATEGORY (PER COUNTRY WORKSPACE)
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

      const workspaceCountryCode = resolveCountryCode(req);

      const deleted = await ServiceCategory.findOneAndDelete({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      });

      if (!deleted) {
        return res.status(404).json({ message: "Category not found ❌" });
      }

      return res.status(200).json({
        message: "Service category deleted ✅",
        countryCode: workspaceCountryCode,
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