// src/routes/adminChat.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

const router = express.Router();

/**
 * ✅ Admin: list conversations
 * GET /api/admin/chats?page=1&limit=50
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { page = 1, limit = 50 } = req.query || {};
      const p = Math.max(1, Number(page));
      const l = Math.min(100, Math.max(1, Number(limit)));

      const items = await Conversation.find({})
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .populate("customer", "name email phone role")
        .populate("provider", "name email phone role")
        .populate("job", "title status roleNeeded createdAt");

      return res.status(200).json({ page: p, limit: l, items });
    } catch (err) {
      return res.status(500).json({ message: "Failed to load conversations", error: err.message });
    }
  }
);

/**
 * ✅ Admin: get messages for a conversation
 * GET /api/admin/chats/:conversationId/messages?page=1&limit=100
 */
router.get(
  "/:conversationId/messages",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { page = 1, limit = 100 } = req.query || {};
      const p = Math.max(1, Number(page));
      const l = Math.min(200, Math.max(1, Number(limit)));

      const messages = await Message.find({ conversation: req.params.conversationId })
        .sort({ createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .populate("sender", "name email phone role");

      return res.status(200).json({ page: p, limit: l, messages: messages.reverse() });
    } catch (err) {
      return res.status(500).json({ message: "Failed to load messages", error: err.message });
    }
  }
);

export default router;