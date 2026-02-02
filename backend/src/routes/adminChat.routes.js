// backend/src/routes/adminChat.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import ChatThread from "../models/ChatThread.js";
import ChatMessage from "../models/ChatMessage.js";

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

const adminOnly = [auth, authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)];

/**
 * ✅ Admin: list chat threads (PER COUNTRY WORKSPACE)
 * GET /api/admin/chats/threads?page=1&limit=50
 */
router.get("/threads", ...adminOnly, async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const { page = 1, limit = 50 } = req.query || {};
    const p = Math.max(1, Number(page));
    const l = Math.min(100, Math.max(1, Number(limit)));

    const items = await ChatThread.find({ countryCode: workspaceCountryCode })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("customer", "name email phone role countryCode")
      .populate("provider", "name email phone role countryCode")
      .populate("job", "title status roleNeeded createdAt");

    return res.status(200).json({
      countryCode: workspaceCountryCode,
      page: p,
      limit: l,
      items,
      threads: items,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load threads", error: err.message });
  }
});

/**
 * ✅ Admin: get messages in a thread (PER COUNTRY)
 * GET /api/admin/chats/threads/:threadId/messages?page=1&limit=100
 */
router.get("/threads/:threadId/messages", ...adminOnly, async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const { page = 1, limit = 100 } = req.query || {};
    const p = Math.max(1, Number(page));
    const l = Math.min(200, Math.max(1, Number(limit)));

    const threadId = req.params.threadId;

    // ✅ ensure thread belongs to this country
    const thread = await ChatThread.findOne({ _id: threadId, countryCode: workspaceCountryCode })
      .select("_id countryCode")
      .lean();

    if (!thread) {
      return res.status(404).json({ message: "Thread not found ❌" });
    }

    const messages = await ChatMessage.find({ thread: threadId, countryCode: workspaceCountryCode })
      .sort({ createdAt: 1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("sender", "name email phone role countryCode");

    return res.status(200).json({
      countryCode: workspaceCountryCode,
      page: p,
      limit: l,
      messages,
      items: messages,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load messages", error: err.message });
  }
});

/**
 * OLD: GET /api/admin/chats  (PER COUNTRY)
 */
router.get("/", ...adminOnly, async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const { page = 1, limit = 50 } = req.query || {};
    const p = Math.max(1, Number(page));
    const l = Math.min(100, Math.max(1, Number(limit)));

    const items = await ChatThread.find({ countryCode: workspaceCountryCode })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("customer", "name email phone role countryCode")
      .populate("provider", "name email phone role countryCode")
      .populate("job", "title status roleNeeded createdAt");

    return res.status(200).json({ countryCode: workspaceCountryCode, page: p, limit: l, items });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load conversations", error: err.message });
  }
});

/**
 * OLD: GET /api/admin/chats/:conversationId/messages  (PER COUNTRY)
 */
router.get("/:conversationId/messages", ...adminOnly, async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const { page = 1, limit = 100 } = req.query || {};
    const p = Math.max(1, Number(page));
    const l = Math.min(200, Math.max(1, Number(limit)));

    const threadId = req.params.conversationId;

    const thread = await ChatThread.findOne({ _id: threadId, countryCode: workspaceCountryCode })
      .select("_id countryCode")
      .lean();

    if (!thread) {
      return res.status(404).json({ message: "Thread not found ❌" });
    }

    const messages = await ChatMessage.find({ thread: threadId, countryCode: workspaceCountryCode })
      .sort({ createdAt: 1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("sender", "name email phone role countryCode");

    return res.status(200).json({ countryCode: workspaceCountryCode, page: p, limit: l, messages });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to load messages", error: err.message });
  }
});

export default router;