// /backend/src/middleware/chatRules.js
import mongoose from "mongoose";
import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";

/**
 * Chat rules:
 * ✅ only ASSIGNED / IN_PROGRESS
 * ✅ unlock after 3 minutes from lockedAt
 * ✅ admin/super admin can access any chat
 * ✅ customer/provider can access only if part of job
 */

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

/**
 * ✅ Named export REQUIRED by chat.routes.js
 */
export async function chatRulesMiddleware(req, res, next) {
  try {
    const user = req.user;
    const jobId =
      req.params.jobId ||
      req.params.id ||
      req.body?.jobId ||
      req.query?.jobId;

    if (!user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ message: "Invalid jobId" });
    }

    const job = await Job.findById(jobId).select("customer assignedTo status lockedAt");
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    const st = normalizeStatus(job.status);

    // ✅ block chat outside active job
    if (!isChatActive(st)) {
      return res.status(403).json({ message: "Chat not available for this job status" });
    }

    // ✅ unlock after 3 minutes
    const mins = minutesSince(job.lockedAt);
    if (mins == null || mins < 3) {
      return res.status(403).json({
        message: "Chat unlocks 3 minutes after provider assignment",
        minutesSinceAssigned: mins ?? 0,
        unlockAfterMinutes: 3,
      });
    }

    const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role);

    const isCustomer = job.customer?.toString() === user._id.toString();
    const isProvider = job.assignedTo?.toString() === user._id.toString();

    if (!isAdmin && !isCustomer && !isProvider) {
      return res.status(403).json({ message: "Not allowed" });
    }

    // ✅ attach job to request (helps routes)
    req.chatJob = job;
    req.chatAccess = { isAdmin, isCustomer, isProvider };

    return next();
  } catch (err) {
    return res.status(500).json({
      message: "Chat permission check failed",
      error: err.message,
    });
  }
}