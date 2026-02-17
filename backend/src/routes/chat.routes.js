import express from "express";
import mongoose from "mongoose";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";
import ChatThread from "../models/ChatThread.js";
import ChatMessage from "../models/ChatMessage.js";
import { maskDigits } from "../utils/maskDigits.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";

const router = express.Router();

/**
 * ✅ Helpers
 */
function resolveReqCountryCode(req) {
  return (
    req.headers["x-country-code"] ||
    req.query?.countryCode ||
    "ZA"
  ).toString().trim().toUpperCase();
}

async function isChatEnabledForCountry(countryCode) {
  const cfg = await CountryServiceConfig.findOne({ countryCode }).select("services.chatEnabled").lean();
  return cfg?.services?.chatEnabled !== false; 
}

function normalizeStatus(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[-\s]/g, "_");
}

function isChatActive(st) {
  const activeStatuses = [
    JOB_STATUSES.ASSIGNED, 
    JOB_STATUSES.IN_PROGRESS, 
    "ACCEPTED", 
    "ARRIVED", 
    "ON_THE_WAY"
  ];
  return activeStatuses.includes(st);
}

async function ensureThread(job) {
  let thread = await ChatThread.findOne({ job: job._id });
  if (!thread) {
    thread = await ChatThread.create({
      job: job._id,
      customer: job.customer,
      provider: job.assignedTo,
      status: "ACTIVE",
    });
  }
  return thread;
}

/**
 * ✅ GET /api/chat/thread/:jobId
 * Matches Android: getChatThread(token, jobId)
 */
router.get("/thread/:jobId", auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(jobId)) return res.status(400).json({ message: "Invalid jobId" });

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const thread = await ensureThread(job);
    return res.status(200).json({ thread });
  } catch (err) {
    return res.status(500).json({ message: "Error", error: err.message });
  }
});

/**
 * ✅ GET /api/chat/messages/:jobId
 * Matches Android: getChatMessages(token, jobId)
 */
router.get("/messages/:jobId", auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(jobId)) return res.status(400).json({ message: "Invalid jobId" });

    const job = await Job.findById(jobId).select("status customer assignedTo");
    if (!job) return res.status(404).json({ message: "Job not found" });

    // Validate access
    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role);
    const isParticipant = job.customer?.toString() === req.user._id.toString() || 
                          job.assignedTo?.toString() === req.user._id.toString();

    if (!isAdmin && !isParticipant) return res.status(403).json({ message: "Not allowed" });

    const thread = await ensureThread(job);
    
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const skip = (page - 1) * limit;

    const items = await ChatMessage.find({ thread: thread._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("sender", "_id name role")
      .lean();

    // Map to Android ChatMessageDto format
    const messages = items.reverse().map(m => ({
      _id: m._id,
      jobId: m.job,
      threadId: m.thread,
      text: m.text,
      message: m.text, // support both keys
      senderRole: m.senderRole,
      createdAt: m.createdAt,
      senderId: {
        _id: m.sender?._id || m.sender,
        name: m.sender?.name,
        role: m.sender?.role || m.senderRole
      }
    }));

    return res.status(200).json({ messages });
  } catch (err) {
    return res.status(500).json({ message: "Failed", error: err.message });
  }
});

/**
 * ✅ POST /api/chat/send/:jobId
 * Matches Android: sendChatMessage(token, jobId, request)
 */
router.post("/send/:jobId", auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const text = (req.body?.text || req.body?.message || "").trim();

    if (!text) return res.status(400).json({ message: "Text required" });
    if (!mongoose.Types.ObjectId.isValid(jobId)) return res.status(400).json({ message: "Invalid jobId" });

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const thread = await ensureThread(job);
    const safeText = maskDigits(text);

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

    // Format for Android ChatSendResponse
    const responseData = {
      _id: msg._id,
      jobId: msg.job,
      text: msg.text,
      message: msg.text,
      senderRole: msg.senderRole,
      createdAt: msg.createdAt,
      senderId: {
        _id: req.user._id,
        name: req.user.name,
        role: req.user.role
      }
    };

    return res.status(201).json({ message: responseData });
  } catch (err) {
    return res.status(500).json({ message: "Send failed", error: err.message });
  }
});

export default router;