// backend/src/routes/chat.routes.js
import express from "express";
import mongoose from "mongoose";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";

import ChatThread from "../models/ChatThread.js";
import ChatMessage from "../models/ChatMessage.js";

import { chatRulesMiddleware } from "../middleware/chatRules.js";
import { maskDigits } from "../utils/maskDigits.js";

import CountryServiceConfig from "../models/CountryServiceConfig.js";

const router = express.Router();

function resolveReqCountryCode(req) {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query?.country ||
    req.query?.countryCode ||
    req.body?.countryCode ||
    process.env.DEFAULT_COUNTRY ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
}

async function isChatEnabledForCountry(countryCode) {
  const cfg = await CountryServiceConfig.findOne({ countryCode }).select("services.chatEnabled").lean();
  const v = cfg?.services?.chatEnabled;
  return typeof v === "boolean" ? v : true;
}

/**
 * ✅ Helpers
 */
function normalizeStatus(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(" ", "_")
    .replace("-", "_");
}

function isActiveChatStatus(st) {
  return st === JOB_STATUSES.ASSIGNED || st === JOB_STATUSES.IN_PROGRESS;
}

/**
 * ✅ Get or create a thread for a job
 *
 * GET /api/chat/thread/:jobId
 */
router.get("/thread/:jobId", auth, chatRulesMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ message: "Invalid jobId" });
    }

    const job = await Job.findById(jobId).select("customer assignedTo status lockedAt");
    if (!job) return res.status(404).json({ message: "Job not found" });

    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role);

    // ✅ Country chat toggle (admins can still access for moderation)
    if (!isAdmin) {
      const cc = resolveReqCountryCode(req);
      const enabled = await isChatEnabledForCountry(cc);
      if (!enabled) return res.status(403).json({ message: "Chat is disabled in this country." });
    }

    const status = normalizeStatus(job.status);

    if (!isActiveChatStatus(status)) {
      return res.status(403).json({ message: "Chat is not available for this job status." });
    }

    const isCustomer = job.customer?.toString() === req.user._id.toString();
    const isProvider = job.assignedTo?.toString() === req.user._id.toString();

    if (!isAdmin && !isCustomer && !isProvider) {
      return res.status(403).json({ message: "Not allowed" });
    }

    let thread = await ChatThread.findOne({ job: job._id });

    if (!thread) {
      thread = await ChatThread.create({
        job: job._id,
        customer: job.customer,
        provider: job.assignedTo,
        status: "ACTIVE",
        lastMessageAt: null,
      });
    } else {
      const updates = {};
      if (job.customer && !thread.customer) updates.customer = job.customer;
      if (job.assignedTo && !thread.provider) updates.provider = job.assignedTo;

      if (Object.keys(updates).length > 0) {
        thread = await ChatThread.findByIdAndUpdate(thread._id, { $set: updates }, { new: true });
      }
    }

    return res.status(200).json({ thread });
  } catch (err) {
    console.error("❌ GET THREAD ERROR:", err);
    return res.status(500).json({ message: "Failed to get thread", error: err.message });
  }
});

/**
 * ✅ List messages
 * GET /api/chat/messages/:threadId?page=1&limit=30
 */
router.get("/messages/:threadId", auth, async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(threadId)) {
      return res.status(400).json({ message: "Invalid threadId" });
    }

    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role);

    // ✅ Country chat toggle (admins can still access)
    if (!isAdmin) {
      const cc = resolveReqCountryCode(req);
      const enabled = await isChatEnabledForCountry(cc);
      if (!enabled) return res.status(403).json({ message: "Chat is disabled in this country." });
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const skip = (page - 1) * limit;

    const thread = await ChatThread.findById(threadId).select("job customer provider status");
    if (!thread) return res.status(404).json({ message: "Thread not found" });

    const job = await Job.findById(thread.job).select("status lockedAt customer assignedTo");
    if (!job) return res.status(404).json({ message: "Job not found" });

    const status = normalizeStatus(job.status);

    if (!isActiveChatStatus(status)) {
      return res.status(403).json({
        message: "Chat history not available after job completion/cancellation.",
      });
    }

    const isCustomer = job.customer?.toString() === req.user._id.toString();
    const isProvider = job.assignedTo?.toString() === req.user._id.toString();

    if (!isAdmin && !isCustomer && !isProvider) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const [items, total] = await Promise.all([
      ChatMessage.find({ thread: thread._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ChatMessage.countDocuments({ thread: thread._id }),
    ]);

    const messages = items.reverse().map((m) => ({ ...m, text: maskDigits(m.text || "") }));

    return res.status(200).json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      messages,
    });
  } catch (err) {
    console.error("❌ LIST MESSAGES ERROR:", err);
    return res.status(500).json({ message: "Failed to load messages", error: err.message });
  }
});

/**
 * ✅ Send message
 * POST /api/chat/messages/:threadId
 */
router.post("/messages/:threadId", auth, async (req, res) => {
  try {
    const { threadId } = req.params;
    const rawText = String(req.body?.text || "").trim();

    if (!mongoose.Types.ObjectId.isValid(threadId)) {
      return res.status(400).json({ message: "Invalid threadId" });
    }
    if (!rawText) {
      return res.status(400).json({ message: "Message text is required" });
    }
    if (rawText.length > 600) {
      return res.status(400).json({ message: "Message too long (max 600 chars)" });
    }

    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role);

    // ✅ Country chat toggle (admins can still access)
    if (!isAdmin) {
      const cc = resolveReqCountryCode(req);
      const enabled = await isChatEnabledForCountry(cc);
      if (!enabled) return res.status(403).json({ message: "Chat is disabled in this country." });
    }

    const thread = await ChatThread.findById(threadId).select("job customer provider status");
    if (!thread) return res.status(404).json({ message: "Thread not found" });

    const job = await Job.findById(thread.job).select("status lockedAt customer assignedTo");
    if (!job) return res.status(404).json({ message: "Job not found" });

    const status = normalizeStatus(job.status);
    if (!isActiveChatStatus(status)) {
      return res.status(403).json({ message: "Chat is not available for this job status." });
    }

    const isCustomer = job.customer?.toString() === req.user._id.toString();
    const isProvider = job.assignedTo?.toString() === req.user._id.toString();

    if (!isAdmin && !isCustomer && !isProvider) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const safeText = maskDigits(rawText);

    const msg = await ChatMessage.create({
      thread: thread._id,
      job: job._id,
      sender: req.user._id,
      senderRole: req.user.role,
      text: safeText,
    });

    await ChatThread.findByIdAndUpdate(thread._id, {
      $set: { lastMessageAt: new Date() },
      $inc: { messageCount: 1 },
    });

    return res.status(201).json({
      message: "Sent ✅",
      chatMessage: {
        _id: msg._id,
        thread: msg.thread,
        job: msg.job,
        sender: msg.sender,
        senderRole: msg.senderRole,
        text: msg.text,
        createdAt: msg.createdAt,
      },
    });
  } catch (err) {
    console.error("❌ SEND MESSAGE ERROR:", err);
    return res.status(500).json({ message: "Failed to send message", error: err.message });
  }
});

/**
 * ✅ ADMIN routes unchanged
 */
router.get(
  "/admin/threads",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
      const skip = (page - 1) * limit;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim().toUpperCase();

      const filter = {};
      if (status) filter.status = status;

      if (q) {
        if (mongoose.Types.ObjectId.isValid(q)) {
          filter.job = q;
        }
      }

      const [items, total] = await Promise.all([
        ChatThread.find(filter)
          .sort({ lastMessageAt: -1, updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("job", "status lockedAt createdAt")
          .populate("customer", "name email role")
          .populate("provider", "name email role")
          .lean(),
        ChatThread.countDocuments(filter),
      ]);

      return res.status(200).json({
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        threads: items,
      });
    } catch (err) {
      console.error("❌ ADMIN THREADS ERROR:", err);
      return res.status(500).json({ message: "Failed to load threads", error: err.message });
    }
  }
);

router.get(
  "/admin/messages/:threadId",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { threadId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(threadId)) {
        return res.status(400).json({ message: "Invalid threadId" });
      }

      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        ChatMessage.find({ thread: threadId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("sender", "name email role")
          .lean(),
        ChatMessage.countDocuments({ thread: threadId }),
      ]);

      const messages = items.reverse().map((m) => ({ ...m, text: maskDigits(m.text || "") }));

      return res.status(200).json({
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        messages,
      });
    } catch (err) {
      console.error("❌ ADMIN MESSAGES ERROR:", err);
      return res.status(500).json({ message: "Failed to load admin messages", error: err.message });
    }
  }
);

export default router;