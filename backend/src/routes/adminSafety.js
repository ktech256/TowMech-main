import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import PanicAlert, { PANIC_STATUSES } from "../models/PanicAlert.js";
import User, { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ Permission helper
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
 * ✅ Admin fetch incidents
 * GET /api/admin/safety/incidents
 */
router.get(
  "/incidents",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageSafety")) return;

      const incidents = await PanicAlert.find()
        .populate("triggeredBy", "name email role")
        .populate("job")
        .sort({ createdAt: -1 });

      return res.status(200).json({ incidents });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch incidents ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Resolve incident
 * PATCH /api/admin/safety/incidents/:id/resolve
 */
router.patch(
  "/incidents/:id/resolve",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageSafety")) return;

      const incident = await PanicAlert.findById(req.params.id);

      if (!incident) {
        return res.status(404).json({ message: "Incident not found ❌" });
      }

      if (incident.status === PANIC_STATUSES.RESOLVED) {
        return res.status(400).json({ message: "Incident already resolved ✅" });
      }

      incident.status = PANIC_STATUSES.RESOLVED;
      incident.resolvedBy = req.user._id;
      incident.resolvedAt = new Date();

      incident.auditLogs.push({
        action: "INCIDENT_RESOLVED",
        by: req.user._id,
        meta: {},
      });

      await incident.save();

      return res.status(200).json({
        message: "Incident resolved ✅",
        incident,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not resolve incident ❌",
        error: err.message,
      });
    }
  }
);

export default router;
