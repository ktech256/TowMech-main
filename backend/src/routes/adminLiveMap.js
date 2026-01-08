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
 * ✅ GET ONLINE PROVIDERS WITH GPS LOCATION
 * GET /api/admin/live/providers
 */
router.get(
  "/providers",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canViewLiveMap")) return;

      const providers = await User.find({
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.isOnline": true,
        "providerProfile.location.coordinates.0": { $exists: true },
        "providerProfile.verificationStatus": "APPROVED",
        "accountStatus.isArchived": { $ne: true },
        "accountStatus.isSuspended": { $ne: true },
        "accountStatus.isBanned": { $ne: true },
      })
        .select(
          "name email role providerProfile.location providerProfile.isOnline providerProfile.lastSeenAt providerProfile.towTruckTypes providerProfile.carTypesSupported"
        )
        .sort({ "providerProfile.lastSeenAt": -1 });

      const formatted = providers.map((p) => {
        const coords = p.providerProfile?.location?.coordinates || [];
        return {
          _id: p._id,
          name: p.name,
          email: p.email,
          role: p.role,
          isOnline: p.providerProfile?.isOnline || false,
          lastSeenAt: p.providerProfile?.lastSeenAt,
          towTruckTypes: p.providerProfile?.towTruckTypes || [],
          carTypesSupported: p.providerProfile?.carTypesSupported || [],
          location: {
            lat: coords[1],
            lng: coords[0],
          },
        };
      });

      return res.status(200).json({
        providers: formatted,
        count: formatted.length,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch live providers",
        error: err.message,
      });
    }
  }
);

export default router;
