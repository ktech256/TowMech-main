import mongoose from "mongoose";

export const TICKET_STATUSES = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
};

export const TICKET_TYPES = {
  PAYMENT: "PAYMENT",
  DRIVER: "DRIVER",
  CUSTOMER: "CUSTOMER",
  JOB: "JOB",
  SAFETY: "SAFETY",
  LOST_ITEM: "LOST_ITEM",
  OTHER: "OTHER",
};

// ✅ NEW: message thread schema
const supportMessageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      required: true, // CUSTOMER / MECHANIC / TOW_TRUCK / ADMIN / SUPER_ADMIN
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

const supportTicketSchema = new mongoose.Schema(
  {
    // ✅ Who created ticket
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ Optional job reference
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
    },

    // ✅ Optional provider reference
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ✅ Ticket category/type
    type: {
      type: String,
      enum: Object.values(TICKET_TYPES),
      default: TICKET_TYPES.OTHER,
    },

    // ✅ Ticket priority
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      default: "MEDIUM",
    },

    // ✅ Ticket status
    status: {
      type: String,
      enum: Object.values(TICKET_STATUSES),
      default: TICKET_STATUSES.OPEN,
    },

    // ✅ Ticket content
    subject: {
      type: String,
      required: true,
      trim: true,
    },

    // ✅ initial message (opener)
    message: {
      type: String,
      required: true,
      trim: true,
    },

    // ✅ NEW: conversation replies
    // - Safe for old tickets (default empty array)
    messages: {
      type: [supportMessageSchema],
      default: [],
    },

    // ✅ Admin assignment
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ✅ Admin internal note
    adminNote: {
      type: String,
      default: "",
    },

    /**
     * ✅ Audit Logs (who did what + when)
     */
    auditLogs: [
      {
        action: { type: String, required: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        timestamp: { type: Date, default: Date.now },
        meta: { type: Object, default: {} },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("SupportTicket", supportTicketSchema);