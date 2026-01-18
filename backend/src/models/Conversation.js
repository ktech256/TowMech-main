// src/models/Conversation.js
import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    status: { type: String, default: "ACTIVE" }, // ACTIVE | CLOSED

    lastMessageText: { type: String, default: "" },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Conversation", conversationSchema);