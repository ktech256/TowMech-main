// backend/src/routes/adminJobs.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import { USER_ROLES } from "../models/User.js";

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
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Permission enforcement helper
 */
const requirePermission = (req, res, permissionKey) => {
  if (req.user.role === USER_ROLES.SUPER_ADMIN) return true;

  if (req.user.role === USER_ROLES.ADMIN) {
    if (!req.user.permissions || req.user.permissions[permissionKey] !== true) {
      res.status(403).json({
        message: `Permission denied ❌ Missing ${permissionKey}`,
      });
      return false;
    }
    return true;
  }

  res.status(403).json({ message: "Permission denied ❌" });
  return false;
};

/**
 * ✅ Block Suspended / Banned admins from doing actions
 */
const blockRestrictedAdmins = (req, res) => {
  if (req.user.accountStatus?.isSuspended) {
    res.status(403).json({ message: "Your admin account is suspended ❌" });
    return true;
  }
  if (req.user.accountStatus?.isBanned) {
    res.status(403).json({ message: "Your admin account is banned ❌" });
    return true;
  }
  return false;
};

/**
 * ✅ GET ALL JOBS (PER COUNTRY)
 * GET /api/admin/jobs
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canManageJobs")) return;

      const workspaceCountryCode = resolveCountryCode(req);

      const jobs = await Job.find({ countryCode: workspaceCountryCode })
        .populate("customer", "name email phone role countryCode")
        .populate("assignedTo", "name email phone role countryCode")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        jobs,
        count: jobs.length,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch jobs",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ GET ACTIVE JOBS ONLY (PER COUNTRY)
 * GET /api/admin/jobs/active
 */
router.get(
  "/active",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canManageJobs")) return;

      const workspaceCountryCode = resolveCountryCode(req);

      const activeStatuses = [
        JOB_STATUSES.CREATED,
        JOB_STATUSES.BROADCASTED,
        JOB_STATUSES.ASSIGNED,
        JOB_STATUSES.IN_PROGRESS,
      ];

      const jobs = await Job.find({
        countryCode: workspaceCountryCode,
        status: { $in: activeStatuses },
      })
        .populate("customer", "name email phone role countryCode")
        .populate("assignedTo", "name email phone role countryCode")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        jobs,
        count: jobs.length,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch active jobs",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ GET SINGLE JOB BY ID (PER COUNTRY)
 * GET /api/admin/jobs/:id
 */
router.get(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canManageJobs")) return;

      const workspaceCountryCode = resolveCountryCode(req);

      const job = await Job.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      })
        .populate("customer", "name email phone role countryCode")
        .populate("assignedTo", "name email phone role countryCode");

      if (!job) return res.status(404).json({ message: "Job not found ❌" });

      return res.status(200).json({ countryCode: workspaceCountryCode, job });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch job",
        error: err.message,
      });
    }
  }
);

export default router;