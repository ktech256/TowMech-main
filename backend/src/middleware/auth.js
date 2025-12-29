import jwt from 'jsonwebtoken';
import User, { USER_ROLES } from '../models/User.js';

const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No authorization token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    /**
     * ✅ Role-based reason visibility
     * Only Admin + SuperAdmin can see ban/suspend reasons
     */
    const canSeeReasons = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role);

    /**
     * ✅ BLOCK users based on accountStatus
     * SuperAdmin bypass allowed (optional)
     */
    const status = user.accountStatus || {};

    const isSuperAdmin = user.role === USER_ROLES.SUPER_ADMIN;

    if (!isSuperAdmin) {
      // ✅ Archived = blocked always
      if (status.isArchived) {
        return res.status(403).json({
          message: 'Account archived. Access denied.'
        });
      }

      // ✅ Banned
      if (status.isBanned) {
        return res.status(403).json({
          message: 'Account banned. Access denied.',
          ...(canSeeReasons && { reason: status.banReason || null })
        });
      }

      // ✅ Suspended
      if (status.isSuspended) {
        return res.status(403).json({
          message: 'Account suspended. Access denied.',
          ...(canSeeReasons && { reason: status.suspendReason || null })
        });
      }
    }

    /**
     * ✅ Attach user to req
     */
    req.user = user;

    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export default auth;