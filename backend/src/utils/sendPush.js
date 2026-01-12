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

    if (typeof value === "string") normalized[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") normalized[key] = String(value);
    else normalized[key] = JSON.stringify(value);
  }

  // ✅ Ensure these always exist (Android service expects them)
  if (normalized.title === undefined) normalized.title = "";
  if (normalized.body === undefined) normalized.body = "";

  return normalized;
}

/**
 * ✅ Resolve token from either providerProfile or root
 */
function getUserFcmToken(user) {
  return user?.providerProfile?.fcmToken || user?.fcmToken || null;
}

/**
 * ✅ IMPORTANT:
 * To guarantee custom sound ALWAYS (foreground + background),
 * we MUST send DATA ONLY payload (NO notification{} block).
 *
 * If notification{} exists, Android may display it automatically in background
 * and you cannot force your custom sound.
 */

// ✅ Must match your Android NotificationChannels.PROVIDER_JOBS_CHANNEL_ID
const ANDROID_CHANNEL_ID = "provider_jobs_channel";

/**
 * ✅ Send push notification to a single user (DATA ONLY)
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

    // ✅ DATA ONLY (NO notification block)
    data: safeData,

    android: {
      priority: "high",
      // ✅ This only helps when the OS shows the notification
      // but since we're DATA-only, your app builds it.
      // Still safe to keep for consistency.
      notification: {
        channelId: ANDROID_CHANNEL_ID,
      },
    },
  };

  return admin.messaging().send(message);
};

/**
 * ✅ Send push to multiple users (DATA ONLY)
 */
export const sendPushToManyUsers = async ({ userIds, title, body, data = {} }) => {
  initFirebase();

  const users = await User.find({ _id: { $in: userIds } });

  const tokens = users
    .map((u) => getUserFcmToken(u))
    .filter(Boolean);

  if (tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  const safeData = normalizeFcmData({ ...data, title, body });

  const message = {
    tokens,

    // ✅ DATA ONLY
    data: safeData,

    android: {
      priority: "high",
      notification: {
        channelId: ANDROID_CHANNEL_ID,
      },
    },
  };

  return admin.messaging().sendEachForMulticast(message);
};