import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import admin, { initFirebase } from "../config/firebase.js";

const router = express.Router();

/**
 * ✅ Test route (GET)
 * GET /api/notifications/test
 */
router.get("/test", (req, res) => {
  return res.status(200).json({ message: "Notifications route working ✅" });
});

/**
 * ✅ Save device token (Customer / Provider)
 * POST /api/notifications/register-token
 *
 * Accept BOTH formats to avoid frontend mismatch:
 * - { fcmToken: "xxx" }
 * - { token: "xxx" }
 */
router.post("/register-token", auth, async (req, res) => {
  try {
    const fcmToken = req.body.fcmToken || req.body.token;

    if (!fcmToken || typeof fcmToken !== "string" || fcmToken.length < 20) {
      return res.status(400).json({ message: "Valid fcmToken/token is required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Save token in root for all users
    user.fcmToken = fcmToken;

    // ✅ If provider → also store inside providerProfile
    const providerRoles = [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC];
    const isProvider = providerRoles.includes(user.role);

    if (isProvider) {
      if (!user.providerProfile) user.providerProfile = {};
      user.providerProfile.fcmToken = fcmToken;
      user.providerProfile.fcmTokenUpdatedAt = new Date();
    }

    await user.save();

    // ✅ IMPORTANT LOGS
    console.log("✅ FCM TOKEN SAVED ✅", {
      userId: user._id.toString(),
      role: user.role,
      savedRoot: !!user.fcmToken,
      savedProviderProfile: !!user.providerProfile?.fcmToken,
      tokenLength: fcmToken.length,
    });

    return res.status(200).json({
      message: "FCM token saved successfully ✅",
      userId: user._id,
      role: user.role,
      savedInRoot: true,
      savedInProviderProfile: isProvider,
    });
  } catch (err) {
    console.error("❌ REGISTER TOKEN ERROR:", err);
    return res.status(500).json({ message: "Could not save token", error: err.message });
  }
});

/**
 * ✅ Send test notification (ADMIN ONLY)
 * POST /api/notifications/send-test
 *
 * ✅ UPDATED:
 * - Sends BOTH notification + data
 * - Ensures android channelId is set
 * - Adds open/jobId/type to data for deep linking tests
 */
router.post("/send-test", auth, authorizeRoles(USER_ROLES.ADMIN), async (req, res) => {
  try {
    initFirebase(); // ✅ ensure firebase initialized

    const { userId, title, body } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({ message: "userId, title, body are required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const token = user.fcmToken || user.providerProfile?.fcmToken;
    if (!token) {
      return res.status(400).json({ message: "User has no saved fcmToken" });
    }

    // ✅✅✅ ONLY CHANGE YOU REQUESTED: replace payload block
    const payload = {
      token,
      notification: { title, body },
      data: {
        open: "job_requests",
        jobId: String(req.body.jobId || ""),
        type: "job_request",
        title: String(title),
        body: String(body),
      },
      android: {
        priority: "high",
        notification: { channelId: "provider_jobs_channel" },
      },
    };

    const response = await admin.messaging().send(payload);

    return res.status(200).json({
      message: "Notification sent successfully ✅",
      response,
    });
  } catch (err) {
    console.error("❌ SEND TEST ERROR:", err);
    return res.status(500).json({ message: "Failed to send notification", error: err.message });
  }
});

/**
 * ✅ DEBUG: Check providers + whether they have tokens (ADMIN ONLY)
 * GET /api/notifications/debug/providers-tokens
 */
router.get(
  "/debug/providers-tokens",
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const providerRoles = [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC];

      const providers = await User.find({ role: { $in: providerRoles } }).select(
        "_id role fcmToken providerProfile.fcmToken providerProfile.isOnline providerProfile.verificationStatus"
      );

      const summary = providers.map((p) => ({
        id: p._id.toString(),
        role: p.role,
        isOnline: p.providerProfile?.isOnline ?? null,
        verificationStatus: p.providerProfile?.verificationStatus ?? null,
        hasRootToken: !!p.fcmToken,
        hasProviderProfileToken: !!p.providerProfile?.fcmToken,
      }));

      return res.status(200).json({
        total: providers.length,
        withAnyToken: summary.filter((x) => x.hasRootToken || x.hasProviderProfileToken).length,
        providers: summary,
      });
    } catch (err) {
      console.error("❌ DEBUG PROVIDERS TOKENS ERROR:", err);
      return res.status(500).json({ message: "Debug failed", error: err.message });
    }
  }
);

export default router;