// src/routes/adminChat.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import ChatThread from "../models/ChatThread.js";
import ChatMessage from "../models/ChatMessage.js";

const router = express.Router();

const adminOnly = [
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
];

// -----------------------------
// ✅ Dashboard-compatible routes
// -----------------------------

/**
 * ✅ Admin: list chat threads
 * GET /api/admin/chats/threads?page=1&limit=50
 */
router.get("/threads", ...adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query || {};
    const p = Math.max(1, Number(page));
    const l = Math.min(100, Math.max(1, Number(limit)));

    const items = await ChatThread.find({})
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("customer", "name email phone role")
      .populate("provider", "name email phone role")
      .populate("job", "title status roleNeeded createdAt");

    // ✅ Keep BOTH keys to avoid breaking any older frontend
    return res.status(200).json({ page: p, limit: l, items, threads: items });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load threads", error: err.message });
  }
});

/**
 * ✅ Admin: get messages in a thread
 * GET /api/admin/chats/threads/:threadId/messages?page=1&limit=100
 */
router.get("/threads/:threadId/messages", ...adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query || {};
    const p = Math.max(1, Number(page));
    const l = Math.min(200, Math.max(1, Number(limit)));

    const threadId = req.params.threadId;

    const messages = await ChatMessage.find({ thread: threadId })
      .sort({ createdAt: 1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("sender", "name email phone role");

    // ✅ Keep BOTH keys to avoid breaking any older frontend
    return res.status(200).json({ page: p, limit: l, messages, items: messages });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load messages", error: err.message });
  }
});

// --------------------------------------------
// ✅ Backward-compatible aliases (your old API)
// --------------------------------------------

/**
 * OLD: GET /api/admin/chats
 * Now returns threads too.
 */
router.get("/", ...adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query || {};
    const p = Math.max(1, Number(page));
    const l = Math.min(100, Math.max(1, Number(limit)));

    const items = await ChatThread.find({})
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("customer", "name email phone role")
      .populate("provider", "name email phone role")
      .populate("job", "title status roleNeeded createdAt");

    return res.status(200).json({ page: p, limit: l, items });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load conversations", error: err.message });
  }
});

/**
 * OLD: GET /api/admin/chats/:conversationId/messages
 * Treats conversationId as threadId for compatibility.
 */
router.get("/:conversationId/messages", ...adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query || {};
    const p = Math.max(1, Number(page));
    const l = Math.min(200, Math.max(1, Number(limit)));

    const threadId = req.params.conversationId;

    const messages = await ChatMessage.find({ thread: threadId })
      .sort({ createdAt: 1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("sender", "name email phone role");

    return res.status(200).json({ page: p, limit: l, messages });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load messages", error: err.message });
  }
});

export default router;