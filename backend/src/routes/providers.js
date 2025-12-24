import express from 'express';
import auth from '../middleware/auth.js';
import User, { USER_ROLES } from '../models/User.js';

const router = express.Router();

/**
 * ✅ Provider updates online/offline + current location
 * PATCH /api/providers/me/status
 */
router.patch('/me/status', auth, async (req, res) => {
  try {
    const { isOnline, lat, lng, towTruckTypes, carTypesSupported } = req.body;

    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only service providers can update status' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.providerProfile) {
      user.providerProfile = {};
    }

    if (typeof isOnline === 'boolean') user.providerProfile.isOnline = isOnline;

    if (lat !== undefined && lng !== undefined) {
      user.providerProfile.location = {
        type: 'Point',
        coordinates: [lng, lat]
      };
    }

    user.providerProfile.lastSeenAt = new Date();

    // Optional update capabilities
    if (Array.isArray(towTruckTypes)) user.providerProfile.towTruckTypes = towTruckTypes;
    if (Array.isArray(carTypesSupported)) user.providerProfile.carTypesSupported = carTypesSupported;

    await user.save();

    return res.status(200).json({ message: 'Provider status updated', providerProfile: user.providerProfile });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update provider status', error: err.message });
  }
});

export default router;
