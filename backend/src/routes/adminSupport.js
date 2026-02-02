// backend/src/routes/adminSupport.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import SupportTicket, { TICKET_STATUSES } from "../models/SupportTicket.js";
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
    req.body?.countryCode ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Admin fetches all support tickets (PER COUNTRY WORKSPACE)
 * GET /api/admin/support/tickets
 */
router.get(
  "/tickets",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);
      const { status, type, priority } = req.query;

      const filter = { countryCode: workspaceCountryCode };
      if (status) filter.status = status;
      if (type) filter.type = type;
      if (priority) filter.priority = priority;

      const count = await SupportTicket.countDocuments(filter);

      const tickets = await SupportTicket.find(filter)
        .sort({ createdAt: -1 })
        .populate("createdBy", "name email role countryCode")
        .populate("provider", "name email role countryCode")
        .populate("assignedTo", "name email role countryCode")
        .populate("job");

      return res.status(200).json({
        countryCode: workspaceCountryCode,
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
 * ✅ Admin fetches single ticket (THREAD) (PER COUNTRY)
 * GET /api/admin/support/tickets/:id
 */
router.get(
  "/tickets/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);

      const ticket = await SupportTicket.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      })
        .populate("createdBy", "name email role countryCode")
        .populate("provider", "name email role countryCode")
        .populate("assignedTo", "name email role countryCode")
        .populate("job")
        .populate("messages.senderId", "name email role countryCode");

      if (!ticket) return res.status(404).json({ message: "Ticket not found ❌" });

      return res.status(200).json({ countryCode: workspaceCountryCode, ticket });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to fetch support ticket ❌",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin assigns ticket to an admin (PER COUNTRY)
 * PATCH /api/admin/support/tickets/:id/assign
 */
router.patch(
  "/tickets/:id/assign",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);
      const { adminId } = req.body;

      const ticket = await SupportTicket.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      });

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
        countryCode: workspaceCountryCode,
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
 * ✅ Admin updates ticket status + adds note (PER COUNTRY)
 * PATCH /api/admin/support/tickets/:id/update
 */
router.patch(
  "/tickets/:id/update",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);
      const { status, adminNote } = req.body;

      const ticket = await SupportTicket.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      });

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
        countryCode: workspaceCountryCode,
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
 * ✅ Admin replies to ticket (THREAD) (PER COUNTRY)
 * POST /api/admin/support/tickets/:id/reply
 * Body: { message: "..." }
 */
router.post(
  "/tickets/:id/reply",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);
      const { message } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({ message: "message is required ❌" });
      }

      const ticket = await SupportTicket.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      });

      if (!ticket) return res.status(404).json({ message: "Ticket not found ❌" });

      if (ticket.status === TICKET_STATUSES.CLOSED) {
        return res.status(400).json({ message: "Ticket is closed ❌" });
      }

      ticket.messages.push({
        senderId: req.user._id,
        senderRole: req.user.role,
        message: message.trim(),
      });

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
        countryCode: workspaceCountryCode,
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