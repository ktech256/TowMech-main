import Job, { JOB_STATUSES } from "../models/Job.js";
import { USER_ROLES } from "../models/User.js";

const CHAT_UNLOCK_DELAY_MS = 3 * 60 * 1000; // 3 minutes after provider assigned (lockedAt)

/**
 * Ensures:
 * - job exists
 * - provider assigned
 * - status active (ASSIGNED/IN_PROGRESS)
 * - lockedAt exists and 3 minutes passed
 * - user is allowed participant (customer/provider/admin)
 */
export async function ensureChatAllowed(req, res, next) {
  try {
    const jobId = req.params.jobId || req.body?.jobId || req.query?.jobId;
    if (!jobId) return res.status(400).json({ message: "jobId is required for chat" });

    const job = await Job.findById(jobId)
      .populate("customer", "role")
      .populate("assignedTo", "role");

    if (!job) return res.status(404).json({ message: "Job not found" });

    const status = job.status;

    // Not allowed after completion/cancel
    if ([JOB_STATUSES.COMPLETED, JOB_STATUSES.CANCELLED].includes(status)) {
      return res.status(403).json({
        code: "CHAT_CLOSED_JOB",
        message: "Chat is not available after job is completed/cancelled.",
      });
    }

    // Only during assigned/in-progress
    const activeAllowed = [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS].includes(status);
    if (!activeAllowed) {
      return res.status(403).json({
        code: "CHAT_NOT_ACTIVE",
        message: "Chat is only available when there is an active job (ASSIGNED / IN_PROGRESS).",
        status,
      });
    }

    if (!job.assignedTo) {
      return res.status(403).json({
        code: "CHAT_NO_PROVIDER",
        message: "Chat is available only after a provider is assigned.",
      });
    }

    // lockedAt gating
    const lockedAt = job.lockedAt ? new Date(job.lockedAt).getTime() : null;
    if (!lockedAt) {
      return res.status(403).json({
        code: "CHAT_LOCKED_AT_MISSING",
        message: "Chat not available yet (assignment time missing).",
      });
    }

    const now = Date.now();
    const unlockAt = lockedAt + CHAT_UNLOCK_DELAY_MS;
    if (now < unlockAt) {
      return res.status(403).json({
        code: "CHAT_LOCKED_WAIT",
        message: "Chat becomes available 3 minutes after provider is assigned.",
        unlockAt: new Date(unlockAt).toISOString(),
        remainingMs: unlockAt - now,
      });
    }

    // participant check
    const userRole = req.user?.role;
    const userId = req.user?._id?.toString();

    const isAdmin =
      userRole === USER_ROLES.ADMIN || userRole === USER_ROLES.SUPER_ADMIN;

    const isCustomer = job.customer?._id?.toString() === userId || job.customer?.toString?.() === userId;
    const isProvider = job.assignedTo?._id?.toString() === userId || job.assignedTo?.toString?.() === userId;

    if (!isAdmin && !isCustomer && !isProvider) {
      return res.status(403).json({
        code: "CHAT_NOT_ALLOWED",
        message: "Not allowed to access this job chat.",
      });
    }

    // attach for downstream
    req.chatJob = job;
    req.chatUnlockAt = new Date(unlockAt);

    next();
  } catch (err) {
    return res.status(500).json({ message: "Chat rules failed", error: err.message });
  }
}

/**
 * Admin can read chats always (history),
 * but still needs job/thread existence checks inside routes.
 */
export function adminChatOnly(req, res, next) {
  const role = req.user?.role;
  const ok = role === USER_ROLES.ADMIN || role === USER_ROLES.SUPER_ADMIN;
  if (!ok) return res.status(403).json({ message: "Admin only" });
  next();
}