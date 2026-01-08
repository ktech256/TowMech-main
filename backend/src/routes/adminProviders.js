import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
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
 * ✅ Block Suspended / Banned admins from doing actions
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
 * ✅ Block verification actions on archived / banned / suspended providers
 */
const blockInvalidProvider = (provider, res) => {
  const status = provider.accountStatus || {};

  if (status.isArchived) {
    res.status(400).json({ message: "Provider is archived ❌ Cannot verify" });
    return true;
  }

  if (status.isSuspended) {
    res.status(400).json({ message: "Provider is suspended ❌ Cannot verify" });
    return true;
  }

  if (status.isBanned) {
    res.status(400).json({ message: "Provider is banned ❌ Cannot verify" });
    return true;
  }

  return false;
};

/**
 * ✅ Admin fetches providers needing verification
 * GET /api/admin/providers/providers/pending
 */
router.get(
  "/providers/pending",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const providers = await User.find({
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": { $ne: "APPROVED" },
        "accountStatus.isArchived": { $ne: true },
      })
        .select("name email role providerProfile createdAt accountStatus")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        providers: providers.map((p) => p.toSafeJSON(req.user.role)),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch pending providers",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin fetches APPROVED providers
 * GET /api/admin/providers/providers/approved
 */
router.get(
  "/providers/approved",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const providers = await User.find({
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": "APPROVED",
        "accountStatus.isArchived": { $ne: true },
      })
        .select("name email role providerProfile createdAt accountStatus")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        providers: providers.map((p) => p.toSafeJSON(req.user.role)),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch approved providers",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin fetches REJECTED providers
 * GET /api/admin/providers/providers/rejected
 */
router.get(
  "/providers/rejected",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const providers = await User.find({
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": "REJECTED",
        "accountStatus.isArchived": { $ne: true },
      })
        .select("name email role providerProfile createdAt accountStatus")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        providers: providers.map((p) => p.toSafeJSON(req.user.role)),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch rejected providers",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin views a provider's verification documents
 * GET /api/admin/providers/providers/:id/verification
 */
router.get(
  "/providers/:id/verification",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const provider = await User.findById(req.params.id).select(
        "name email role providerProfile.verificationDocs providerProfile.verificationStatus accountStatus"
      );

      if (!provider)
        return res.status(404).json({ message: "Provider not found" });

      return res.status(200).json({
        provider: provider.toSafeJSON(req.user.role),
        verificationStatus: provider.providerProfile?.verificationStatus,
        verificationDocs: provider.providerProfile?.verificationDocs || {},
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch verification docs",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin approves provider
 * PATCH /api/admin/providers/providers/:id/approve
 */
router.patch(
  "/providers/:id/approve",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const provider = await User.findById(req.params.id);
      if (!provider)
        return res.status(404).json({ message: "Provider not found" });

      // ✅ Ensure provider
      if (![USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC].includes(provider.role)) {
        return res.status(400).json({ message: "Target user is not a provider ❌" });
      }

      // ✅ Block invalid provider
      if (blockInvalidProvider(provider, res)) return;

      if (!provider.providerProfile) provider.providerProfile = {};

      provider.providerProfile.verificationStatus = "APPROVED";
      provider.providerProfile.verifiedAt = new Date();
      provider.providerProfile.verifiedBy = req.user._id;

      await provider.save();

      return res.status(200).json({
        message: "Provider approved successfully ✅",
        provider: provider.toSafeJSON(req.user.role),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not approve provider",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin rejects provider
 * PATCH /api/admin/providers/providers/:id/reject
 */
router.patch(
  "/providers/:id/reject",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const provider = await User.findById(req.params.id);
      if (!provider)
        return res.status(404).json({ message: "Provider not found" });

      // ✅ Ensure provider
      if (![USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC].includes(provider.role)) {
        return res.status(400).json({ message: "Target user is not a provider ❌" });
      }

      // ✅ Block invalid provider
      if (blockInvalidProvider(provider, res)) return;

      if (!provider.providerProfile) provider.providerProfile = {};

      provider.providerProfile.verificationStatus = "REJECTED";
      provider.providerProfile.verifiedAt = new Date();
      provider.providerProfile.verifiedBy = req.user._id;

      await provider.save();

      return res.status(200).json({
        message: "Provider rejected successfully ✅",
        provider: provider.toSafeJSON(req.user.role),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not reject provider",
        error: err.message,
      });
    }
  }
);

export default router;
