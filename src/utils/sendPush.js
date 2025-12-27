import admin, { initFirebase } from '../config/firebase.js';
import User from '../models/User.js';

/**
 * ✅ Send push notification to a single user
 */
export const sendPushToUser = async ({ userId, title, body, data = {} }) => {
  initFirebase(); // ✅ ensure Firebase initialized

  const user = await User.findById(userId);
  if (!user) return null;

  const token = user.providerProfile?.fcmToken;
  if (!token) return null;

  const payload = {
    token,
    notification: {
      title,
      body
    },
    data // ✅ optional for mobile apps later
  };

  return admin.messaging().send(payload);
};

/**
 * ✅ Send push to multiple users (batch)
 */
export const sendPushToManyUsers = async ({ userIds, title, body, data = {} }) => {
  initFirebase();

  const users = await User.find({
    _id: { $in: userIds },
    'providerProfile.fcmToken': { $ne: null }
  });

  const tokens = users
    .map((u) => u.providerProfile?.fcmToken)
    .filter(Boolean);

  if (tokens.length === 0) return { successCount: 0 };

  const payload = {
    notification: { title, body },
    tokens,
    data
  };

  return admin.messaging().sendEachForMulticast(payload);
};