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
     * ✅ BLOCK users based on accountStatus
     * SuperAdmin is allowed to bypass (optional)
     */
    const status = user.accountStatus || {};

    // ✅ SuperAdmin bypass
    const isSuperAdmin = user.role === USER_ROLES.SUPER_ADMIN;

    if (!isSuperAdmin) {
      if (status.isArchived) {
        return res.status(403).json({
          message: 'Account archived. Access denied.'
        });
      }

      if (status.isBanned) {
        return res.status(403).json({
          message: 'Account banned. Access denied.',
          reason: status.banReason || null
        });
      }

      if (status.isSuspended) {
        return res.status(403).json({
          message: 'Account suspended. Access denied.',
          reason: status.suspendReason || null
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