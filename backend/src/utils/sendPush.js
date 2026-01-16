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
 * ✅ Must match Android NotificationChannels.PROVIDER_JOBS_CHANNEL_ID
 * IMPORTANT:
 * - Heads-up + sound in Android 8+ depends on this channel settings on the phone.
 */
const ANDROID_CHANNEL_ID = "provider_jobs_channel";

/**
 * ✅ Send push notification to a single user (NOTIFICATION + DATA)
 *
 * - notification => Heads-up in background/killed
 * - data         => jobId/open/type etc
 *
 * data can include:
 *  - open: "job_requests"
 *  - jobId: "..."
 *  - type: "job_request"
 */
export const sendPushToUser = async ({ userId, title, body, data = {} }) => {
  initFirebase();

  const user = await User.findById(userId);
  if (!user) return null;

  const token = getUserFcmToken(user);
  if (!token) return null;

  const safeData = normalizeFcmData({
    ...data,
    title,
    body,
  });

  const message = {
    token,

    // ✅ Heads-up
    notification: {
      title: String(title || ""),
      body: String(body || ""),
    },

    // ✅ App routing / metadata
    data: safeData,

    android: {
      priority: "high",
      notification: {
        channelId: ANDROID_CHANNEL_ID,

        // Optional: keep it visible
        // clickAction is only useful if you handle it in AndroidManifest / FirebaseMessagingService
      },
    },
  };

  return admin.messaging().send(message);
};

/**
 * ✅ Send push to multiple users (NOTIFICATION + DATA)
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

  const safeData = normalizeFcmData({
    ...data,
    title,
    body,
  });

  const message = {
    tokens,

    // ✅ Heads-up
    notification: {
      title: String(title || ""),
      body: String(body || ""),
    },

    // ✅ App routing / metadata
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

/**
 * ✅ Helper: Cancel / remove job banner on other providers
 */
export const sendCancelJobToManyUsers = async ({ userIds, jobId, reason = "job_taken" }) => {
  return sendPushToManyUsers({
    userIds,
    title: "Job Update",
    body: "Job no longer available",
    data: {
      open: reason, // "job_taken" | "job_cancelled" | "job_unavailable"
      jobId: String(jobId),
      type: "job_update",
    },
  });
};