// backend/src/routes/adminProviders.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";

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
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Enforce country workspace rules (same as adminUsers)
 * - SuperAdmin can view any workspace
 * - Admin can only view:
 *    - their own country workspace
 *    - OR any workspace IF canSwitchCountryWorkspace=true
 *
 * ✅ If admin cannot switch, FORCE workspaceCountryCode to user.countryCode.
 */
const enforceWorkspaceAccess = (req, res, workspaceCountryCode) => {
  const role = req.user?.role;
  const userCountry = String(req.user?.countryCode || "ZA").toUpperCase();
  const canSwitch = !!req.user?.permissions?.canSwitchCountryWorkspace;

  if (role === USER_ROLES.SUPER_ADMIN) {
    req.countryCode = workspaceCountryCode;
    return true;
  }

  if (role === USER_ROLES.ADMIN && !canSwitch) {
    req.countryCode = userCountry; // 🔒 force lock
    return true;
  }

  req.countryCode = workspaceCountryCode;
  return true;
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
 * ✅ Admin fetches providers needing verification (PER COUNTRY)
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

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const providers = await User.find({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": { $ne: "APPROVED" },
        "accountStatus.isArchived": { $ne: true },
      })
        .select("name email role countryCode providerProfile createdAt accountStatus")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
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
 * ✅ Admin fetches APPROVED providers (PER COUNTRY)
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

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const providers = await User.find({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": "APPROVED",
        "accountStatus.isArchived": { $ne: true },
      })
        .select("name email role countryCode providerProfile createdAt accountStatus")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
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
 * ✅ Admin fetches REJECTED providers (PER COUNTRY)
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

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const providers = await User.find({
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": "REJECTED",
        "accountStatus.isArchived": { $ne: true },
      })
        .select("name email role countryCode providerProfile createdAt accountStatus")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
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
 * ✅ Admin views a provider's verification documents (PER COUNTRY)
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

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const provider = await User.findById(req.params.id).select(
        "name email role countryCode providerProfile.verificationDocs providerProfile.verificationStatus accountStatus"
      );

      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        String(provider.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "Provider not found" });
      }

      return res.status(200).json({
        countryCode: workspaceCountryCode,
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

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (![USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC].includes(provider.role)) {
        return res.status(400).json({ message: "Target user is not a provider ❌" });
      }

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        String(provider.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "Provider not found" });
      }

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

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (![USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC].includes(provider.role)) {
        return res.status(400).json({ message: "Target user is not a provider ❌" });
      }

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        String(provider.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "Provider not found" });
      }

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