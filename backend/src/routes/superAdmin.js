import express from 'express';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import User, { USER_ROLES } from '../models/User.js';

const router = express.Router();

/**
 * ✅ SuperAdmin creates a new Admin
 * POST /api/super-admin/admins
 */
router.post(
  '/admins',
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { name, email, password, permissions } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ message: 'name, email, password are required' });
      }

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: 'Admin already exists with this email' });
      }

      const adminUser = await User.create({
        name,
        email,
        password,
        role: USER_ROLES.ADMIN,
        permissions: permissions || {
          canManageUsers: true,
          canManagePricing: true,
          canViewStats: true,
          canVerifyProviders: true
        }
      });

      return res.status(201).json({
        message: 'Admin created successfully ✅',
        admin: adminUser.toSafeJSON(USER_ROLES.SUPER_ADMIN)
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Could not create admin',
        error: err.message
      });
    }
  }
);

/**
 * ✅ SuperAdmin updates Admin permissions
 * PATCH /api/super-admin/admins/:id/permissions
 */
router.patch(
  '/admins/:id/permissions',
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const adminUser = await User.findById(req.params.id);

      if (!adminUser) return res.status(404).json({ message: 'Admin not found' });

      if (adminUser.role !== USER_ROLES.ADMIN) {
        return res.status(400).json({ message: 'User is not an admin' });
      }

      if (!adminUser.permissions) adminUser.permissions = {};

      Object.assign(adminUser.permissions, req.body);

      await adminUser.save();

      return res.status(200).json({
        message: 'Admin permissions updated ✅',
        admin: adminUser.toSafeJSON(USER_ROLES.SUPER_ADMIN)
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Could not update permissions',
        error: err.message
      });
    }
  }
);

export default router;