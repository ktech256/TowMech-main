import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import SupportTicket from "../models/SupportTicket.js";
import { USER_ROLES } from "../models/User.js";
import { TICKET_STATUSES } from "../models/SupportTicket.js";

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
 * ✅ Admin fetches single ticket (THREAD)
 * GET /api/admin/support/tickets/:id
 */
router.get(
  "/tickets/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const ticket = await SupportTicket.findById(req.params.id)
        .populate("createdBy", "name email role")
        .populate("provider", "name email role")
        .populate("assignedTo", "name email role")
        .populate("job")
        .populate("messages.senderId", "name email role");

      if (!ticket) return res.status(404).json({ message: "Ticket not found ❌" });

      return res.status(200).json({ ticket });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch support ticket ❌",
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
      ticket.status = TICKET_STATUSES.IN_PROGRESS;

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

      if (status && Object.values(TICKET_STATUSES).includes(status)) {
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

/**
 * ✅ Admin replies to ticket (THREAD)
 * POST /api/admin/support/tickets/:id/reply
 * Body: { message: "..." }
 */
router.post(
  "/tickets/:id/reply",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { message } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({ message: "message is required ❌" });
      }

      const ticket = await SupportTicket.findById(req.params.id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found ❌" });

      // ✅ block replies to CLOSED
      if (ticket.status === TICKET_STATUSES.CLOSED) {
        return res.status(400).json({ message: "Ticket is closed ❌" });
      }

      ticket.messages.push({
        senderId: req.user._id,
        senderRole: req.user.role,
        message: message.trim(),
      });

      // ✅ If admin replies while OPEN, move to IN_PROGRESS automatically
      if (ticket.status === TICKET_STATUSES.OPEN) {
        ticket.status = TICKET_STATUSES.IN_PROGRESS;
        ticket.auditLogs.push({
          action: "STATUS_CHANGED",
          by: req.user._id,
          meta: { status: ticket.status, reason: "ADMIN_REPLIED" },
        });
      }

      ticket.auditLogs.push({
        action: "ADMIN_REPLIED",
        by: req.user._id,
        meta: { length: message.trim().length },
      });

      await ticket.save();

      return res.status(200).json({
        message: "Reply sent ✅",
        ticket,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to send reply ❌",
        error: err.message,
      });
    }
  }
);

export default router;