import mongoose from "mongoose";

const ChatThreadSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, unique: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, default: null },

    // Useful for filtering/search in admin
    roleNeeded: { type: String, default: null },

    // ACTIVE while job is ASSIGNED/IN_PROGRESS
    status: { type: String, enum: ["ACTIVE", "CLOSED"], default: "ACTIVE" },

    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: "" },

    // optional: store when chat became allowed (lockedAt+3min)
    unlockedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Handy indexes
ChatThreadSchema.index({ status: 1, lastMessageAt: -1 });
ChatThreadSchema.index({ customer: 1, lastMessageAt: -1 });
ChatThreadSchema.index({ provider: 1, lastMessageAt: -1 });

const ChatThread = mongoose.model("ChatThread", ChatThreadSchema);
export default ChatThread;