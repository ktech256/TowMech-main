import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import NotificationLog from "../models/NotificationLog.js";
import admin, { initFirebase } from "../config/firebase.js";

const router = express.Router();

/**
 * ✅ Must match Android NotificationChannels.PROVIDER_JOBS_CHANNEL_ID
 */
const ANDROID_CHANNEL_ID = "provider_jobs_channel_v2";

/**
 * ✅ Admin broadcast notification
 * POST /api/admin/notifications/broadcast
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

      // ✅ Fetch users with tokens
      const users = await User.find(query).select("_id role fcmToken providerProfile.fcmToken");

      // keep mapping so we can delete dead tokens later
      const tokenRows = users
        .map((u) => {
          const token = u.fcmToken || u.providerProfile?.fcmToken || null;
          if (!token) return null;

          return {
            userId: u._id.toString(),
            token,
            field: u.fcmToken ? "fcmToken" : "providerProfile.fcmToken",
          };
        })
        .filter(Boolean);

      const tokens = tokenRows.map((x) => x.token);
      const totalTargets = tokens.length;

      if (totalTargets === 0) {
        return res.status(400).json({
          message: "No users found with saved FCM tokens ❌",
          totalTargets,
        });
      }

      // ✅ Send push notification (multicast)
      // NOTE: include BOTH notification (heads-up) + data (your Android service reads data)
      const payload = {
        tokens,

        notification: { title, body },

        data: {
          title: String(title),
          body: String(body),
          open: "admin_broadcast",
          type: "admin_broadcast",
        },

        android: {
          priority: "high",
          notification: {
            channelId: ANDROID_CHANNEL_ID,
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(payload);

      // ✅ Auto-remove dead tokens
      const deadTokenIndexes = response.responses
        .map((r, idx) => {
          if (r.success) return null;
          const code = r.error?.code || "";
          if (code === "messaging/registration-token-not-registered") return idx;
          if (code === "messaging/invalid-registration-token") return idx;
          return null;
        })
        .filter((x) => x !== null);

      const deadRows = deadTokenIndexes.map((idx) => tokenRows[idx]);

      // clear both places for safety
      let removedCount = 0;
      if (deadRows.length > 0) {
        const deadTokens = deadRows.map((x) => x.token);

        const result = await User.updateMany(
          {
            $or: [
              { fcmToken: { $in: deadTokens } },
              { "providerProfile.fcmToken": { $in: deadTokens } },
            ],
          },
          {
            $set: {
              fcmToken: null,
              "providerProfile.fcmToken": null,
            },
          }
        );

        removedCount = result.modifiedCount || 0;
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
        removedInvalidTokens: removedCount,
        errors: response.responses
          .map((r) => (r.success ? null : { code: r.error?.code, message: r.error?.message }))
          .filter(Boolean),
      });

      return res.status(200).json({
        message: "Broadcast sent ✅",
        stats: {
          totalTargets,
          success: response.successCount,
          failed: response.failureCount,
          removedInvalidTokens: removedCount,
        },
        log,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to send broadcast ❌",
        error: err.message,
      });
    }
  }
);

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