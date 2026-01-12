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
 */
const ANDROID_CHANNEL_ID = "provider_jobs_channel";

/**
 * ✅ Send push notification to a single user (DATA ONLY)
 *
 * data can include:
 *  - open: "job_requests"
 *  - jobId: "..."
 *  - pickup, dropoff, amount, currency, distanceKm (strings/numbers ok)
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

    // ✅ DATA ONLY (NO notification block)
    data: safeData,

    android: {
      priority: "high",
      // Safe to keep, but does NOT force system notification since it's data-only.
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

  const safeData = normalizeFcmData({
    ...data,
    title,
    body,
  });

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

/**
 * ✅ Helper: Cancel / remove job banner on other providers
 * Call this when:
 *  - another provider accepted the job
 *  - job expired / cancelled
 *
 * The Android app will cancel the notification immediately
 * because it checks open=job_cancelled/job_taken/job_unavailable.
 */
export const sendCancelJobToManyUsers = async ({ userIds, jobId, reason = "job_taken" }) => {
  return sendPushToManyUsers({
    userIds,
    title: "Job Update",
    body: "Job no longer available",
    data: {
      open: reason, // "job_taken" | "job_cancelled" | "job_unavailable"
      jobId: String(jobId),
    },
  });
};