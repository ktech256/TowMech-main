// /backend/src/socket/chatSocket.js
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";
import ChatThread from "../models/ChatThread.js";
import ChatMessage from "../models/ChatMessage.js";
import { maskDigits } from "../utils/maskDigits.js";

/**
 * ✅ Socket auth:
 * client connects with:
 *  - auth: { token: "Bearer xxx" } OR { token: "xxx" }
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

function isChatActive(st) {
  return st === JOB_STATUSES.ASSIGNED || st === JOB_STATUSES.IN_PROGRESS;
}

function minutesSince(date) {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms / 60000;
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

  // ✅ block completed/cancelled/created/broadcasted
  if (!isChatActive(st)) {
    return { ok: false, status: 403, message: "Chat not available for this job status" };
  }

  // ✅ must be unlocked after 3 minutes from lockedAt
  const mins = minutesSince(job.lockedAt);
  if (mins == null || mins < 3) {
    return { ok: false, status: 403, message: "Chat unlocks 3 minutes after assignment" };
  }

  const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role);
  const isCustomer = job.customer?.toString() === user._id.toString();
  const isProvider = job.assignedTo?.toString() === user._id.toString();

  if (!isAdmin && !isCustomer && !isProvider) {
    return { ok: false, status: 403, message: "Not allowed" };
  }

  return { ok: true, job, isAdmin, isCustomer, isProvider };
}

export function registerChatSocket(io) {
  // ✅ auth middleware
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    // eslint-disable-next-line no-console
    console.log("✅ chat socket connected:", socket.user?._id);

    /**
     * Join a job chat room (job:<jobId>)
     * client emits: chat:join { jobId }
     */
    socket.on("chat:join", async (payload, cb) => {
      try {
        const jobId = payload?.jobId;
        const access = await validateChatAccess({ user: socket.user, jobId });

        if (!access.ok) {
          if (typeof cb === "function") cb({ ok: false, message: access.message });
          return;
        }

        const room = `job:${access.job._id.toString()}`;
        socket.join(room);

        const thread = await ensureThread(access.job);

        if (typeof cb === "function") {
          cb({ ok: true, room, threadId: thread._id.toString() });
        }
      } catch (err) {
        if (typeof cb === "function") cb({ ok: false, message: "Join failed" });
      }
    });

    /**
     * Send message
     * client emits: chat:send { jobId, text }
     */
    socket.on("chat:send", async (payload, cb) => {
      try {
        const jobId = payload?.jobId;
        const rawText = String(payload?.text || "").trim();

        if (!rawText) {
          if (typeof cb === "function") cb({ ok: false, message: "Text is required" });
          return;
        }
        if (rawText.length > 600) {
          if (typeof cb === "function") cb({ ok: false, message: "Message too long" });
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

        const out = {
          _id: msg._id.toString(),
          thread: msg.thread.toString(),
          job: msg.job.toString(),
          sender: msg.sender.toString(),
          senderRole: msg.senderRole,
          text: msg.text,
          createdAt: msg.createdAt,
        };

        const room = `job:${access.job._id.toString()}`;
        io.to(room).emit("chat:new_message", out);

        if (typeof cb === "function") cb({ ok: true, message: out });
      } catch (err) {
        if (typeof cb === "function") cb({ ok: false, message: "Send failed" });
      }
    });

    socket.on("disconnect", () => {
      // eslint-disable-next-line no-console
      console.log("🔌 chat socket disconnected:", socket.user?._id);
    });
  });
}