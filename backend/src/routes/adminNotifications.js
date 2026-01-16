import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import NotificationLog from "../models/NotificationLog.js";
import admin, { initFirebase } from "../config/firebase.js";

const router = express.Router();

/**
 * Helper: get a user's best token (providerProfile first, then root)
 * and track where it came from so we can delete safely.
 */
function resolveUserToken(user) {
  const providerToken = user?.providerProfile?.fcmToken;
  const rootToken = user?.fcmToken;

  if (providerToken) return { token: providerToken, field: "providerProfile.fcmToken" };
  if (rootToken) return { token: rootToken, field: "fcmToken" };

  return { token: null, field: null };
}

/**
 * FCM data values must be strings
 */
function normalizeFcmData(data = {}) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    else out[k] = JSON.stringify(v);
  }
  return out;
}

/**
 * These error codes mean the token is dead and should be removed.
 * (Firebase Admin SDK typically provides error.code like "messaging/registration-token-not-registered")
 */
function isDeadTokenErrorCode(code = "") {
  const c = String(code || "").toLowerCase();
  return (
    c.includes("registration-token-not-registered") ||
    c.includes("invalid-registration-token") ||
    c.includes("invalid-argument") // sometimes shown for bad tokens
  );
}

/**
 * ✅ Admin broadcast notification
 * POST /api/admin/notifications/broadcast
 *
 * Body:
 * {
 *   "audience": "ALL" | "CUSTOMERS" | "PROVIDERS",
 *   "providerRole": "ALL" | "TOW_TRUCK" | "MECHANIC",
 *   "title": "Hello",
 *   "body": "Message..."
 * }
 */
router.post(
  "/broadcast",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      initFirebase();

      const { audience, providerRole, title, body } = req.body;

      if (!title || !body) {
        return res.status(400).json({ message: "title and body are required" });
      }

      const chosenAudience = (audience || "ALL").toUpperCase();
      const chosenProviderRole = (providerRole || "ALL").toUpperCase();

      // ✅ Build query
      const query = {};

      if (chosenAudience === "CUSTOMERS") {
        query.role = USER_ROLES.CUSTOMER;
      }

      if (chosenAudience === "PROVIDERS") {
        query.role = { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] };

        if (chosenProviderRole === "TOW_TRUCK") query.role = USER_ROLES.TOW_TRUCK;
        if (chosenProviderRole === "MECHANIC") query.role = USER_ROLES.MECHANIC;
      }

      // ✅ Fetch users with tokens (include _id so we can clean invalid tokens)
      const users = await User.find(query).select("_id fcmToken providerProfile.fcmToken role");

      // Build token targets with mapping so we can delete dead tokens safely
      const targets = [];
      for (const u of users) {
        const { token, field } = resolveUserToken(u);
        if (!token) continue;

        targets.push({
          userId: u._id,
          token,
          field, // "providerProfile.fcmToken" OR "fcmToken"
        });
      }

      const tokens = targets.map((t) => t.token);
      const totalTargets = tokens.length;

      if (totalTargets === 0) {
        return res.status(400).json({
          message: "No users found with saved FCM tokens ❌",
          totalTargets,
        });
      }

      // ✅ Send push notification (multicast)
      // IMPORTANT:
      // - notification => Android system shows heads-up (if channel importance is HIGH on device)
      // - data => app can handle custom sound / routing
      const safeData = normalizeFcmData({
        open: "admin_broadcast",
        title,
        body,
        audience: chosenAudience,
        providerRole: chosenAudience === "PROVIDERS" ? chosenProviderRole : "ALL",
      });

      const payload = {
        tokens,

        // ✅ Heads-up / visible notification
        notification: { title, body },

        // ✅ Data for app logic (sound, navigation, etc.)
        data: safeData,

        android: {
          priority: "high",
          notification: {
            // Do NOT force a channelId here (prevents mismatch across apps/roles).
            // Let Android use the app default/fallback channel.
            // sound is controlled by channel on Android 8+, but keeping "default" is harmless.
            sound: "default",
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(payload);

      // ✅ Extract failures with real error codes
      const failures = response.responses
        .map((r, idx) => {
          if (r.success) return null;

          const err = r.error || {};
          return {
            index: idx,
            token: tokens[idx],
            userId: String(targets[idx]?.userId || ""),
            field: targets[idx]?.field || "",
            code: err.code || "",
            message: err.message || "",
          };
        })
        .filter(Boolean);

      // ✅ Log failures clearly (Render logs)
      if (failures.length > 0) {
        console.error("❌ FCM BROADCAST FAILURES:", failures);
      } else {
        console.log("✅ FCM BROADCAST: all delivered", {
          totalTargets,
          successCount: response.successCount,
        });
      }

      // ✅ Remove dead tokens automatically
      const dead = failures.filter((f) => isDeadTokenErrorCode(f.code));
      for (const f of dead) {
        try {
          if (!f.userId) continue;

          // Remove token from the correct field
          if (f.field === "providerProfile.fcmToken") {
            await User.updateOne(
              { _id: f.userId },
              { $unset: { "providerProfile.fcmToken": 1 } }
            );
          } else if (f.field === "fcmToken") {
            await User.updateOne({ _id: f.userId }, { $unset: { fcmToken: 1 } });
          }

          // Safety: also unset root token if it matches (prevents duplicates)
          await User.updateOne({ _id: f.userId, fcmToken: f.token }, { $unset: { fcmToken: 1 } });
          await User.updateOne(
            { _id: f.userId, "providerProfile.fcmToken": f.token },
            { $unset: { "providerProfile.fcmToken": 1 } }
          );
        } catch (e) {
          console.error("❌ Failed to cleanup dead token", {
            userId: f.userId,
            token: f.token,
            error: e?.message,
          });
        }
      }

      const log = await NotificationLog.create({
        sentBy: req.user._id,
        audience: chosenAudience,
        providerRole: chosenAudience === "PROVIDERS" ? chosenProviderRole : "ALL",
        title,
        body,
        totalTargets,
        sentCount: response.successCount,
        failedCount: response.failureCount,

        // Store useful error details
        errors: failures.map((f) => ({
          userId: f.userId,
          field: f.field,
          code: f.code,
          message: f.message,
        })),
      });

      return res.status(200).json({
        message: "Broadcast sent ✅",
        stats: {
          totalTargets,
          success: response.successCount,
          failed: response.failureCount,
          deadTokensRemoved: dead.length,
        },
        failures, // include in response so you can see exact reason quickly
        log,
      });
    } catch (err) {
      console.error("❌ Broadcast error:", err);
      return res.status(500).json({
        message: "Failed to send broadcast ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Fetch broadcast logs
 * GET /api/admin/notifications/logs
 */
router.get(
  "/logs",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const logs = await NotificationLog.find()
        .sort({ createdAt: -1 })
        .populate("sentBy", "name email role");

      return res.status(200).json({ logs });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch logs ❌",
        error: err.message,
      });
    }
  }
);

export default router;