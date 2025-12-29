/**
 * ✅ Permission middleware for Admin users
 * Example usage:
 * authorizePermissions('canManageUsers')
 */
const authorizePermissions = (...requiredPermissions) => {
  return (req, res, next) => {
    const user = req.user;

    // ✅ SuperAdmin bypasses everything
    if (user.role === 'SuperAdmin') return next();

    // ✅ Must be Admin
    if (user.role !== 'Admin') {
      return res.status(403).json({ message: 'Only Admin users allowed ❌' });
    }

    // ✅ Permissions required
    const perms = user.permissions || {};

    const missing = requiredPermissions.filter((perm) => perms[perm] !== true);

    if (missing.length > 0) {
      return res.status(403).json({
        message: 'Permission denied ❌',
        missingPermissions: missing
      });
    }

    return next();
  };
};

export default authorizePermissions;