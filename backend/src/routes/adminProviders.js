import express from 'express';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import User, { USER_ROLES } from '../models/User.js';

const router = express.Router();

/**
 * ✅ Admin fetches all providers needing verification
 * GET /api/admin/providers/pending
 */
router.get(
  '/providers/pending',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const providers = await User.find({
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        'providerProfile.verificationStatus': { $ne: 'APPROVED' }
      })
        .select('name email role providerProfile createdAt')
        .sort({ createdAt: -1 });

      return res.status(200).json({ providers });
    } catch (err) {
      return res.status(500).json({ message: 'Could not fetch providers', error: err.message });
    }
  }
);

/**
 * ✅ Admin views a provider's verification documents
 * GET /api/admin/providers/:id/verification
 */
router.get(
  '/providers/:id/verification',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const provider = await User.findById(req.params.id).select(
        'name email role providerProfile.verificationDocs providerProfile.verificationStatus'
      );

      if (!provider) return res.status(404).json({ message: 'Provider not found' });

      return res.status(200).json({
        provider: {
          id: provider._id,
          name: provider.name,
          email: provider.email,
          role: provider.role
        },
        verificationStatus: provider.providerProfile?.verificationStatus,
        verificationDocs: provider.providerProfile?.verificationDocs || {}
      });
    } catch (err) {
      return res.status(500).json({ message: 'Could not fetch verification docs', error: err.message });
    }
  }
);

/**
 * ✅ Admin approves provider
 * PATCH /api/admin/providers/:id/approve
 */
router.patch(
  '/providers/:id/approve',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: 'Provider not found' });

      if (!provider.providerProfile) provider.providerProfile = {};

      provider.providerProfile.verificationStatus = 'APPROVED';
      provider.providerProfile.verifiedAt = new Date();
      provider.providerProfile.verifiedBy = req.user._id;

      await provider.save();

      return res.status(200).json({
        message: 'Provider approved successfully',
        provider: {
          id: provider._id,
          name: provider.name,
          email: provider.email,
          role: provider.role,
          verificationStatus: provider.providerProfile.verificationStatus
        }
      });
    } catch (err) {
      return res.status(500).json({ message: 'Could not approve provider', error: err.message });
    }
  }
);

/**
 * ✅ Admin rejects provider
 * PATCH /api/admin/providers/:id/reject
 */
router.patch(
  '/providers/:id/reject',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: 'Provider not found' });

      if (!provider.providerProfile) provider.providerProfile = {};

      provider.providerProfile.verificationStatus = 'REJECTED';
      provider.providerProfile.verifiedAt = new Date();
      provider.providerProfile.verifiedBy = req.user._id;

      await provider.save();

      return res.status(200).json({
        message: 'Provider rejected successfully',
        provider: {
          id: provider._id,
          name: provider.name,
          email: provider.email,
          role: provider.role,
          verificationStatus: provider.providerProfile.verificationStatus
        }
      });
    } catch (err) {
      return res.status(500).json({ message: 'Could not reject provider', error: err.message });
    }
  }
);

export default router;
