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

  // ✅ If last argument is a string → treat as permission key
  if (typeof rolesOrPermission[rolesOrPermission.length - 1] === 'string') {
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
     * ✅ SuperAdmin always allowed (after restriction checks)
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
     * ✅ If permission is required, check admin.permissions
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