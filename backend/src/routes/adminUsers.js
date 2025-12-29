import express from 'express';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import User, { USER_ROLES } from '../models/User.js';

const router = express.Router();

/**
 * ✅ ADMIN / SUPERADMIN: suspend a user
 * PATCH /api/admin/users/:id/suspend
 */
router.patch(
  '/users/:id/suspend',
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { reason } = req.body;

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: 'User not found' });

      // ✅ Admin cannot suspend SuperAdmin
      if (target.role === USER_ROLES.SUPER_ADMIN && req.user.role !== USER_ROLES.SUPER_ADMIN) {
        return res.status(403).json({ message: 'Only SuperAdmin can suspend another SuperAdmin' });
      }

      if (!target.accountStatus) target.accountStatus = {};

      target.accountStatus.isSuspended = true;
      target.accountStatus.suspendedAt = new Date();
      target.accountStatus.suspendedBy = req.user._id;
      target.accountStatus.suspendReason = reason || 'Suspended by admin';

      await target.save();

      return res.status(200).json({
        message: 'User suspended ✅',
        user: target.toSafeJSON(req.user.role)
      });
    } catch (err) {
      return res.status(500).json({ message: 'Could not suspend user', error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: unsuspend a user
 * PATCH /api/admin/users/:id/unsuspend
 */
router.patch(
  '/users/:id/unsuspend',
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: 'User not found' });

      if (!target.accountStatus) target.accountStatus = {};

      target.accountStatus.isSuspended = false;
      target.accountStatus.suspendedAt = null;
      target.accountStatus.suspendedBy = null;
      target.accountStatus.suspendReason = null;

      await target.save();

      return res.status(200).json({
        message: 'User unsuspended ✅',
        user: target.toSafeJSON(req.user.role)
      });
    } catch (err) {
      return res.status(500).json({ message: 'Could not unsuspend user', error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: ban a user
 * PATCH /api/admin/users/:id/ban
 */
router.patch(
  '/users/:id/ban',
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { reason } = req.body;

      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: 'User not found' });

      if (target.role === USER_ROLES.SUPER_ADMIN && req.user.role !== USER_ROLES.SUPER_ADMIN) {
        return res.status(403).json({ message: 'Only SuperAdmin can ban another SuperAdmin' });
      }

      if (!target.accountStatus) target.accountStatus = {};

      target.accountStatus.isBanned = true;
      target.accountStatus.bannedAt = new Date();
      target.accountStatus.bannedBy = req.user._id;
      target.accountStatus.banReason = reason || 'Banned by admin';

      await target.save();

      return res.status(200).json({
        message: 'User banned ✅',
        user: target.toSafeJSON(req.user.role)
      });
    } catch (err) {
      return res.status(500).json({ message: 'Could not ban user', error: err.message });
    }
  }
);

/**
 * ✅ ADMIN / SUPERADMIN: unban a user
 * PATCH /api/admin/users/:id/unban
 */
router.patch(
  '/users/:id/unban',
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: 'User not found' });

      if (!target.accountStatus) target.accountStatus = {};

      target.accountStatus.isBanned = false;
      target.accountStatus.bannedAt = null;
      target.accountStatus.bannedBy = null;
      target.accountStatus.banReason = null;

      await target.save();

      return res.status(200).json({
        message: 'User unbanned ✅',
        user: target.toSafeJSON(req.user.role)
      });
    } catch (err) {
      return res.status(500).json({ message: 'Could not unban user', error: err.message });
    }
  }
);

/**
 * ✅ SUPERADMIN ONLY: archive a user
 * PATCH /api/admin/users/:id/archive
 */
router.patch(
  '/users/:id/archive',
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const target = await User.findById(req.params.id);
      if (!target) return res.status(404).json({ message: 'User not found' });

      if (!target.accountStatus) target.accountStatus = {};

      target.accountStatus.isArchived = true;
      target.accountStatus.archivedAt = new Date();
      target.accountStatus.archivedBy = req.user._id;

      await target.save();

      return res.status(200).json({
        message: 'User archived ✅',
        user: target.toSafeJSON(req.user.role)
      });
    } catch (err) {
      return res.status(500).json({ message: 'Could not archive user', error: err.message });
    }
  }
);

export default router;