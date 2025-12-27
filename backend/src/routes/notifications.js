import express from 'express';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import User, { USER_ROLES } from '../models/User.js';
import admin, { initFirebase } from '../config/firebase.js';

const router = express.Router();

/**
 * ✅ Test route (GET)
 * GET /api/notifications/test
 */
router.get('/test', (req, res) => {
  return res.status(200).json({ message: 'Notifications route working ✅' });
});

/**
 * ✅ Save device token (Customer / Provider)
 * POST /api/notifications/register-token
 */
router.post('/register-token', auth, async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ message: 'fcmToken is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // ✅ Save token in root (works for everyone)
    user.fcmToken = fcmToken;

    // ✅ Also store inside providerProfile if provider
    if (!user.providerProfile) user.providerProfile = {};
    user.providerProfile.fcmToken = fcmToken;

    await user.save();

    return res.status(200).json({ message: 'FCM token saved successfully ✅' });
  } catch (err) {
    return res.status(500).json({ message: 'Could not save token', error: err.message });
  }
});

/**
 * ✅ Send test notification (ADMIN ONLY)
 * POST /api/notifications/send-test
 */
router.post(
  '/send-test',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      initFirebase(); // ✅ ensure firebase initialized

      const { userId, title, body } = req.body;

      if (!userId || !title || !body) {
        return res.status(400).json({ message: 'userId, title, body are required' });
      }

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const token = user.fcmToken || user.providerProfile?.fcmToken;
      if (!token) {
        return res.status(400).json({ message: 'User has no saved fcmToken' });
      }

      const payload = {
        token,
        notification: {
          title,
          body
        }
      };

      const response = await admin.messaging().send(payload);

      return res.status(200).json({
        message: 'Notification sent successfully ✅',
        response
      });
    } catch (err) {
      return res.status(500).json({ message: 'Failed to send notification', error: err.message });
    }
  }
);

export default router;
