import express from "express";
import auth from "../middleware/auth.js";
import SupportTicket, { TICKET_TYPES, TICKET_STATUSES } from "../models/SupportTicket.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ Customer creates support ticket
 * POST /api/support/tickets
 */
router.post("/tickets", auth, async (req, res) => {
  try {
    // ✅ Only customers/providers can create tickets (admins should use admin panel)
    if ([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role)) {
      return res.status(403).json({
        message: "Admins should create/manage tickets via Admin dashboard ❌",
      });
    }

    const { subject, message, type, priority, jobId, providerId } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        message: "subject and message are required ❌",
      });
    }

    const ticket = await SupportTicket.create({
      createdBy: req.user._id,
      job: jobId || null,
      provider: providerId || null,
      subject,
      message,
      type: type || TICKET_TYPES.OTHER,
      priority: priority || "MEDIUM",
      status: TICKET_STATUSES.OPEN,
      auditLogs: [
        {
          action: "TICKET_CREATED",
          by: req.user._id,
          meta: { subject, type },
        },
      ],
    });

    return res.status(201).json({
      message: "Support ticket created ✅",
      ticket,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to create support ticket ❌",
      error: err.message,
    });
  }
});

/**
 * ✅ Customer fetches own tickets
 * GET /api/support/tickets
 */
router.get("/tickets", auth, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ createdBy: req.user._id })
      .sort({ createdAt: -1 })
      .populate("job")
      .populate("provider", "name email role");

    return res.status(200).json({ tickets });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to fetch tickets ❌",
      error: err.message,
    });
  }
});

/**
 * ✅ Customer fetches single ticket (includes thread)
 * GET /api/support/tickets/:id
 */
router.get("/tickets/:id", auth, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id)
      .populate("job")
      .populate("provider", "name email role")
      .populate("assignedTo", "name email role")
      .populate("messages.senderId", "name email role");

    if (!ticket) return res.status(404).json({ message: "Ticket not found ❌" });

    // ✅ Only owner can view
    if (ticket.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized ❌" });
    }

    return res.status(200).json({ ticket });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to fetch ticket ❌",
      error: err.message,
    });
  }
});

/**
 * ✅ Customer replies to ticket (THREAD)
 * POST /api/support/tickets/:id/reply
 * Body: { message: "..." }
 */
router.post("/tickets/:id/reply", auth, async (req, res) => {
  try {
    // admins should reply via admin route
    if ([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role)) {
      return res.status(403).json({
        message: "Admins should reply via Admin dashboard ❌",
      });
    }

    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "message is required ❌" });
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found ❌" });

    // ✅ Only owner can reply
    if (ticket.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized ❌" });
    }

    // ✅ block replies to CLOSED
    if (ticket.status === TICKET_STATUSES.CLOSED) {
      return res.status(400).json({ message: "Ticket is closed ❌" });
    }

    ticket.messages.push({
      senderId: req.user._id,
      senderRole: req.user.role,
      message: message.trim(),
    });

    // ✅ If customer replies after RESOLVED, reopen it to IN_PROGRESS (useful)
    if (ticket.status === TICKET_STATUSES.RESOLVED) {
      ticket.status = TICKET_STATUSES.IN_PROGRESS;
      ticket.auditLogs.push({
        action: "STATUS_CHANGED",
        by: req.user._id,
        meta: { status: ticket.status, reason: "CUSTOMER_REPLIED" },
      });
    }

    ticket.auditLogs.push({
      action: "CUSTOMER_REPLIED",
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
});

export default router;