import mongoose from "mongoose";

const ChatMessageSchema = new mongoose.Schema(
  {
    thread: { type: mongoose.Schema.Types.ObjectId, ref: "ChatThread", required: true },

    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },

    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderRole: { type: String, default: "" }, // "Customer" | "Mechanic" | "TowTruck" | "Admin" etc.

    // Stored as already-masked text (contacts blocked)
    text: { type: String, required: true },

    // If you later add attachments:
    // attachmentUrl: { type: String, default: null },
  },
  { timestamps: true }
);

ChatMessageSchema.index({ thread: 1, createdAt: -1 });
ChatMessageSchema.index({ job: 1, createdAt: -1 });

const ChatMessage = mongoose.model("ChatMessage", ChatMessageSchema);
export default ChatMessage;