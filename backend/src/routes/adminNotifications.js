// backend/src/routes/adminNotifications.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import NotificationLog from "../models/NotificationLog.js";
import admin, { initFirebase } from "../config/firebase.js";

const router = express.Router();

/**
 * ✅ Resolve active workspace country (Tenant)
 */
const resolveCountryCode = (req) => {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query?.country ||
    req.query?.countryCode ||
    req.body?.countryCode ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Must match Android NotificationChannels.PROVIDER_JOBS_CHANNEL_ID
 */
const ANDROID_CHANNEL_ID = "provider_jobs_channel_v2";

/**
 * ✅ Admin broadcast notification (PER COUNTRY WORKSPACE)
 * POST /api/admin/notifications/broadcast
 */
router.post(
  "/broadcast",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      initFirebase();

      const workspaceCountryCode = resolveCountryCode(req);
      const { audience, providerRole, title, body } = req.body;

      if (!title || !body) {
        return res.status(400).json({ message: "title and body are required" });
      }

      const chosenAudience = (audience || "ALL").toUpperCase();
      const chosenProviderRole = (providerRole || "ALL").toUpperCase();

      // ✅ Build query (scoped to country)
      const query = { countryCode: workspaceCountryCode };

      if (chosenAudience === "CUSTOMERS") {
        query.role = USER_ROLES.CUSTOMER;
      }

      if (chosenAudience === "PROVIDERS") {
        query.role = { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] };
        if (chosenProviderRole === "TOW_TRUCK") query.role = USER_ROLES.TOW_TRUCK;
        if (chosenProviderRole === "MECHANIC") query.role = USER_ROLES.MECHANIC;
      }

      // ALL: keep query.role undefined (still country scoped)

      const users = await User.find(query).select(
        "_id role countryCode fcmToken providerProfile.fcmToken"
      );

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
          countryCode: workspaceCountryCode,
          totalTargets,
        });
      }

      const payload = {
        tokens,
        notification: { title, body },
        data: {
          title: String(title),
          body: String(body),
          open: "admin_broadcast",
          type: "admin_broadcast",
          countryCode: workspaceCountryCode,
        },
        android: {
          priority: "high",
          notification: { channelId: ANDROID_CHANNEL_ID },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(payload);

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

      let removedCount = 0;
      if (deadRows.length > 0) {
        const deadTokens = deadRows.map((x) => x.token);

        const result = await User.updateMany(
          {
            countryCode: workspaceCountryCode,
            $or: [
              { fcmToken: { $in: deadTokens } },
              { "providerProfile.fcmToken": { $in: deadTokens } },
            ],
          },
          { $set: { fcmToken: null, "providerProfile.fcmToken": null } }
        );

        removedCount = result.modifiedCount || 0;
      }

      const log = await NotificationLog.create({
        sentBy: req.user._id,
        countryCode: workspaceCountryCode,
        audience: chosenAudience,
        providerRole: chosenAudience === "PROVIDERS" ? chosenProviderRole : "ALL",
        title,
        body,
        totalTargets,
        sentCount: response.successCount,
        failedCount: response.failureCount,
        removedInvalidTokens: removedCount,
        errors: response.responses
          .map((r) =>
            r.success ? null : { code: r.error?.code, message: r.error?.message }
          )
          .filter(Boolean),
      });

      return res.status(200).json({
        message: "Broadcast sent ✅",
        countryCode: workspaceCountryCode,
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

/**
 * ✅ Get logs (PER COUNTRY WORKSPACE)
 * GET /api/admin/notifications/logs
 */
router.get(
  "/logs",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);

      const logs = await NotificationLog.find({ countryCode: workspaceCountryCode })
        .sort({ createdAt: -1 })
        .populate("sentBy", "name email role");

      return res.status(200).json({ countryCode: workspaceCountryCode, logs });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch logs ❌",
        error: err.message,
      });
    }
  }
);

export default router;