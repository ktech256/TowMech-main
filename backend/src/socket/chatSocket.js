import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";
import ChatThread from "../models/ChatThread.js";
import ChatMessage from "../models/ChatMessage.js";
import { maskDigits } from "../utils/maskDigits.js";

/**
 * ✅ Socket auth middleware
 */
async function socketAuthMiddleware(socket, next) {
  try {
    const raw = socket?.handshake?.auth?.token || socket?.handshake?.headers?.authorization;

    if (!raw) return next(new Error("Missing token"));

    const token = String(raw).replace("Bearer ", "").trim();
    if (!token) return next(new Error("Invalid token"));

    const secret = process.env.JWT_SECRET || process.env.SECRET || "dev_secret";
    const decoded = jwt.verify(token, secret);

    const userId = decoded?.id || decoded?._id || decoded?.userId;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return next(new Error("Invalid token payload"));
    }

    const user = await User.findById(userId).select("_id role name email");
    if (!user) return next(new Error("User not found"));

    socket.user = {
      _id: user._id.toString(),
      role: user.role,
      name: user.name || "",
      email: user.email || "",
    };

    return next();
  } catch (err) {
    return next(new Error("Unauthorized"));
  }
}

function normalizeStatus(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(" ", "_")
    .replace("-", "_");
}

/**
 * ✅ Check if chat should be open based on job status
 */
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

  return thread;
}

async function validateChatAccess({ user, jobId }) {
  if (!user?._id) return { ok: false, status: 401, message: "Unauthorized" };
  if (!mongoose.Types.ObjectId.isValid(jobId))
    return { ok: false, status: 400, message: "Invalid jobId" };

  const job = await Job.findById(jobId).select("customer assignedTo status lockedAt");
  if (!job) return { ok: false, status: 404, message: "Job not found" };

  const st = normalizeStatus(job.status);

  // ✅ Check if status allows chat
  if (!isChatActive(st)) {
    return { ok: false, status: 403, message: `Chat unavailable for status: ${st}` };
  }

  // ✅ REMOVED: The 3-minute lockout (Chat now works immediately upon assignment)

  const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role);
  const isCustomer = job.customer?.toString() === user._id.toString();
  const isProvider = job.assignedTo?.toString() === user._id.toString();

  if (!isAdmin && !isCustomer && !isProvider) {
    return { ok: false, status: 403, message: "You are not a participant in this job" };
  }

  return { ok: true, job, isAdmin, isCustomer, isProvider };
}

export function registerChatSocket(io) {
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    console.log("✅ Chat socket connected:", socket.user?._id);

    /**
     * Join a job chat room
     */
    socket.on("chat:join", async (payload, cb) => {
      try {
        const jobId = payload?.jobId;
        const access = await validateChatAccess({ user: socket.user, jobId });

        if (!access.ok) {
          console.warn("❌ Join denied:", access.message);
          if (typeof cb === "function") cb({ ok: false, message: access.message });
          return;
        }

        const room = `job:${access.job._id.toString()}`;
        socket.join(room);

        const thread = await ensureThread(access.job);

        console.log(`👤 User ${socket.user._id} joined room: ${room}`);
        if (typeof cb === "function") {
          cb({ ok: true, room, threadId: thread._id.toString() });
        }
      } catch (err) {
        console.error("Join error:", err);
        if (typeof cb === "function") cb({ ok: false, message: "Join failed" });
      }
    });

    /**
     * Send message and broadcast to room
     */
    socket.on("chat:send", async (payload, cb) => {
      try {
        const jobId = payload?.jobId;
        const rawText = String(payload?.text || payload?.message || "").trim();

        if (!rawText) {
          if (typeof cb === "function") cb({ ok: false, message: "Text is required" });
          return;
        }

        const access = await validateChatAccess({ user: socket.user, jobId });
        if (!access.ok) {
          if (typeof cb === "function") cb({ ok: false, message: access.message });
          return;
        }

        const thread = await ensureThread(access.job);
        const safeText = maskDigits(rawText);

        const msg = await ChatMessage.create({
          thread: thread._id,
          job: access.job._id,
          sender: socket.user._id,
          senderRole: socket.user.role,
          text: safeText,
        });

        await ChatThread.findByIdAndUpdate(thread._id, {
          $set: { lastMessageAt: new Date() },
          $inc: { messageCount: 1 },
        });

        // ✅ Format object to match Android's ChatMessageDto & FlexibleUser models
        const out = {
          _id: msg._id.toString(),
          threadId: msg.thread.toString(),
          jobId: msg.job.toString(),
          senderId: { 
            _id: socket.user._id,
            name: socket.user.name,
            role: socket.user.role
          },
          senderRole: socket.user.role,
          text: msg.text,
          message: msg.text, // Redundant field for compatibility
          createdAt: msg.createdAt,
        };

        const room = `job:${access.job._id.toString()}`;
        io.to(room).emit("chat:new_message", out);
        
        console.log(`✉️ Message from ${socket.user._id} broadcast to ${room}`);

        if (typeof cb === "function") cb({ ok: true, message: out });
      } catch (err) {
        console.error("Send error:", err);
        if (typeof cb === "function") cb({ ok: false, message: "Send failed" });
      }
    });

    socket.on("disconnect", () => {
      console.log("🔌 Chat socket disconnected:", socket.user?._id);
    });
  });
}