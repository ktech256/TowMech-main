import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import NotificationLog from "../models/NotificationLog.js";
import admin, { initFirebase } from "../config/firebase.js";

const router = express.Router();

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

      // ✅ Fetch users with tokens
      const users = await User.find(query).select("fcmToken providerProfile.fcmToken role");

      const tokens = users
        .map((u) => u.fcmToken || u.providerProfile?.fcmToken)
        .filter(Boolean);

      const totalTargets = tokens.length;

      if (totalTargets === 0) {
        return res.status(400).json({
          message: "No users found with saved FCM tokens ❌",
          totalTargets,
        });
      }

      // ✅ Send push notification (multicast)
      const payload = {
        tokens,
        notification: { title, body },
      };

      const response = await admin.messaging().sendEachForMulticast(payload);

      const log = await NotificationLog.create({
        sentBy: req.user._id,
        audience: chosenAudience,
        providerRole: chosenAudience === "PROVIDERS" ? chosenProviderRole : "ALL",
        title,
        body,
        totalTargets,
        sentCount: response.successCount,
        failedCount: response.failureCount,
        errors: response.responses
          .map((r, idx) => (r.success ? null : { message: r.error?.message }))
          .filter(Boolean),
      });

      return res.status(200).json({
        message: "Broadcast sent ✅",
        stats: {
          totalTargets,
          success: response.successCount,
          failed: response.failureCount,
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
