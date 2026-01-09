import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import PanicAlert, { PANIC_STATUSES } from "../models/PanicAlert.js";
import User, { USER_ROLES } from "../models/User.js";
import Job from "../models/Job.js";

const router = express.Router();

/**
 * ✅ Panic Alert Trigger
 * POST /api/safety/panic
 *
 * Body:
 * {
 *   jobId?: string,
 *   lat: number,
 *   lng: number,
 *   message?: string
 * }
 */
router.post(
  "/panic",
  auth,
  authorizeRoles(USER_ROLES.CUSTOMER, USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC),
  async (req, res) => {
    try {
      const { jobId, lat, lng, message } = req.body;

      if (lat === undefined || lng === undefined) {
        return res.status(400).json({
          message: "lat and lng are required ❌",
        });
      }

      let job = null;
      if (jobId) {
        job = await Job.findById(jobId);
      }

      const alert = await PanicAlert.create({
        triggeredBy: req.user._id,
        triggeredRole: req.user.role,
        job: job ? job._id : null,
        location: { lat, lng },
        message: message || "",
        status: PANIC_STATUSES.OPEN,
        auditLogs: [
          {
            action: "PANIC_TRIGGERED",
            by: req.user._id,
            meta: { jobId: jobId || null },
          },
        ],
      });

      return res.status(201).json({
        message: "Panic alert sent ✅",
        alert,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not trigger panic alert ❌",
        error: err.message,
      });
    }
  }
);

export default router;
