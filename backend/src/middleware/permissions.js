import { USER_ROLES } from '../models/User.js';

/**
 * ✅ Middleware: Check permission block for Admin
 * Usage: requirePermission("canManageUsers")
 */
const requirePermission = (permissionKey) => {
  return (req, res, next) => {
    // ✅ SuperAdmin bypass
    if (req.user.role === USER_ROLES.SUPER_ADMIN) return next();

    // ✅ Must be admin
    if (req.user.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only Admin or SuperAdmin allowed' });
    }

    // ✅ Permission check
    if (!req.user.permissions || req.user.permissions[permissionKey] !== true) {
      return res.status(403).json({
        message: `Admin missing permission: ${permissionKey}`
      });
    }

    next();
  };
};

export default requirePermission;