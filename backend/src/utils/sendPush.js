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
    else if (typeof value === "number" || typeof value === "boolean")
      normalized[key] = String(value);
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
 * ✅ MUST match Android NotificationChannels.PROVIDER_JOBS_CHANNEL_ID
 * Your Android is: provider_jobs_channel_v3
 */
const ANDROID_CHANNEL_ID = "provider_jobs_channel_v3";

/**
 * ✅ Send push notification to a single user (DATA-ONLY for Banners)
 */
export const sendPushToUser = async ({ userId, title, body, data = {} }) => {
  initFirebase();

  const user = await User.findById(userId);
  if (!user) return null;

  const token = getUserFcmToken(user);
  if (!token) return null;

  // ✅ Supports sending mechanicCategoryNeeded, customerProblemDescription, etc.
  // We include title and body here because we are removing the notification block.
  const safeData = normalizeFcmData({
    ...data,
    title,
    body,
  });

  const message = {
    token,

    /* 
     * ❌ REMOVED the 'notification' block.
     * By only sending 'data', we force the Android system to trigger 
     * onMessageReceived in the background, allowing the app to launch the Banner.
     */
    
    data: safeData,

    android: {
      priority: "high", // ✅ Mandatory for heads-up behavior
      ttl: 3600 * 1000, // 1 hour
    },
  };

  return admin.messaging().send(message);
};

/**
 * ✅ Send push to multiple users (DATA-ONLY for Banners)
 */
export const sendPushToManyUsers = async ({ userIds, title, body, data = {} }) => {
  initFirebase();

  const users = await User.find({ _id: { $in: userIds } });

  const tokens = users.map((u) => getUserFcmToken(u)).filter(Boolean);

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

    /* 
     * ❌ REMOVED the 'notification' block.
     * This ensures the app process is woken up to handle the banner logic.
     */

    data: safeData,

    android: {
      priority: "high",
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
      open: reason,
      jobId: String(jobId),
      type: "job_update",
    },
  });
};