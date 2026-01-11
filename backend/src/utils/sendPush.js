import admin, { initFirebase } from "../config/firebase.js";
import User from "../models/User.js";

/**
 * ✅ FCM requires all "data" values to be strings.
 * Convert nested objects safely.
 */
function normalizeFcmData(data = {}) {
  const normalized = {};

  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) continue;

    // FCM data values must be strings
    if (typeof value === "string") normalized[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") normalized[key] = String(value);
    else normalized[key] = JSON.stringify(value);
  }

  // Helpful: include title/body in data too (foreground handling)
  if (!normalized.title) normalized.title = "";
  if (!normalized.body) normalized.body = "";

  return normalized;
}

/**
 * ✅ Resolve token from either providerProfile or root
 */
function getUserFcmToken(user) {
  return user?.providerProfile?.fcmToken || user?.fcmToken || null;
}

/**
 * ✅ Send push notification to a single user
 */
export const sendPushToUser = async ({ userId, title, body, data = {} }) => {
  initFirebase();

  const user = await User.findById(userId);
  if (!user) return null;

  const token = getUserFcmToken(user);
  if (!token) return null;

  const safeData = normalizeFcmData({ ...data, title, body });

  const message = {
    token,

    // ✅ Notification payload (Android shows in background automatically)
    notification: { title, body },

    // ✅ Data payload (for your app logic / foreground handling)
    data: safeData,

    // ✅ Strong Android delivery settings
    android: {
      priority: "high",
      notification: {
        channelId: "towmech_default_channel", // must match your Android channel id
        sound: "default",
      },
    },
  };

  return admin.messaging().send(message);
};

/**
 * ✅ Send push to multiple users (batch)
 */
export const sendPushToManyUsers = async ({ userIds, title, body, data = {} }) => {
  initFirebase();

  // ✅ Fetch users and accept either providerProfile token OR root token
  const users = await User.find({ _id: { $in: userIds } });

  const tokens = users
    .map((u) => getUserFcmToken(u))
    .filter(Boolean);

  if (tokens.length === 0) return { successCount: 0, failureCount: 0, responses: [] };

  const safeData = normalizeFcmData({ ...data, title, body });

  const message = {
    tokens,
    notification: { title, body },
    data: safeData,
    android: {
      priority: "high",
      notification: {
        channelId: "towmech_default_channel",
        sound: "default",
      },
    },
  };

  return admin.messaging().sendEachForMulticast(message);
};