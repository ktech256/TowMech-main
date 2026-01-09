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
 * ✅ Customer fetches single ticket
 * GET /api/support/tickets/:id
 */
router.get("/tickets/:id", auth, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id)
      .populate("job")
      .populate("provider", "name email role")
      .populate("assignedTo", "name email role");

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

export default router;
