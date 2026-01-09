import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import SupportTicket from "../models/SupportTicket.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ Admin fetches all support tickets
 * GET /api/admin/support/tickets
 */
router.get(
  "/tickets",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { status, type, priority } = req.query;

      // ✅ DEBUG: Count all documents in DB
      const count = await SupportTicket.countDocuments();
      console.log("✅ TOTAL SUPPORT TICKETS:", count);

      const filter = {};
      if (status) filter.status = status;
      if (type) filter.type = type;
      if (priority) filter.priority = priority;

      const tickets = await SupportTicket.find(filter)
        .sort({ createdAt: -1 })
        .populate("createdBy", "name email role")
        .populate("provider", "name email role")
        .populate("assignedTo", "name email role")
        .populate("job");

      return res.status(200).json({
        count,
        tickets,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch support tickets ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin assigns ticket to an admin
 * PATCH /api/admin/support/tickets/:id/assign
 */
router.patch(
  "/tickets/:id/assign",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { adminId } = req.body;

      const ticket = await SupportTicket.findById(req.params.id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found ❌" });

      ticket.assignedTo = adminId || req.user._id;
      ticket.status = "IN_PROGRESS";

      ticket.auditLogs.push({
        action: "TICKET_ASSIGNED",
        by: req.user._id,
        meta: { assignedTo: ticket.assignedTo },
      });

      await ticket.save();

      return res.status(200).json({
        message: "Ticket assigned ✅",
        ticket,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to assign ticket ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin updates ticket status + adds note
 * PATCH /api/admin/support/tickets/:id/update
 */
router.patch(
  "/tickets/:id/update",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { status, adminNote } = req.body;

      const ticket = await SupportTicket.findById(req.params.id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found ❌" });

      if (status) {
        ticket.status = status;
        ticket.auditLogs.push({
          action: "STATUS_CHANGED",
          by: req.user._id,
          meta: { status },
        });
      }

      if (adminNote !== undefined) {
        ticket.adminNote = adminNote;
        ticket.auditLogs.push({
          action: "NOTE_ADDED",
          by: req.user._id,
        });
      }

      await ticket.save();

      return res.status(200).json({
        message: "Ticket updated ✅",
        ticket,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to update ticket ❌",
        error: err.message,
      });
    }
  }
);

export default router;
