// src/models/Message.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },

    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderRole: { type: String, default: "" },

    text: { type: String, required: true },
    sanitized: { type: Boolean, default: false },
    sanitizeNote: { type: String, default: "" },

    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);