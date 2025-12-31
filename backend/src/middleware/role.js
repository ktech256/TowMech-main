import { USER_ROLES } from '../models/User.js';

/**
 * ✅ authorizeRoles(...roles, optionalPermission)
 *
 * Example:
 * authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)
 * authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageUsers")
 */
const authorizeRoles = (...rolesOrPermission) => {
  let requiredPermission = null;

  // ✅ Known permission keys
  const permissionKeys = [
    "canManageUsers",
    "canManagePricing",
    "canViewStats",
    "canVerifyProviders"
  ];

  // ✅ Only treat last argument as permission if it matches valid permission key
  const lastArg = rolesOrPermission[rolesOrPermission.length - 1];

  if (typeof lastArg === "string" && permissionKeys.includes(lastArg)) {
    requiredPermission = rolesOrPermission.pop();
  }

  const allowedRoles = rolesOrPermission;

  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: 'Not authenticated ❌' });
    }

    const role = req.user.role;

    /**
     * ✅ Block restricted admins/superadmins
     */
    if (req.user.accountStatus?.isSuspended) {
      return res.status(403).json({ message: 'Account suspended ❌' });
    }

    if (req.user.accountStatus?.isBanned) {
      return res.status(403).json({ message: 'Account banned ❌' });
    }

    /**
     * ✅ SuperAdmin always allowed
     */
    if (role === USER_ROLES.SUPER_ADMIN) {
      return next();
    }

    /**
     * ✅ Role must match
     */
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        message: 'Access denied: role not allowed ❌',
        requiredRoles: allowedRoles,
        yourRole: role
      });
    }

    /**
     * ✅ Permission check only for admins
     */
    if (requiredPermission) {
      if (!req.user.permissions || req.user.permissions[requiredPermission] !== true) {
        return res.status(403).json({
          message: `Access denied: missing permission (${requiredPermission}) ❌`
        });
      }
    }

    return next();
  };
};

export default authorizeRoles;