const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");

const ChatThread = require("../models/ChatThread");
const ChatMessage = require("../models/ChatMessage");

// ✅ GET /api/admin/chats/threads
// Returns threads for admin dashboard
router.get("/threads", protect, adminOnly, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    const filter = {};
    // optional: add search later if you want (by jobId, etc.)
    // for now keep stable and fast.

    const threads = await ChatThread.find(filter)
      .populate({ path: "job", select: "title status pickupAddressText dropoffAddressText" })
      .populate({ path: "customer", select: "name role email phone" })
      .populate({ path: "provider", select: "name role email phone" })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(500);

    res.json({ threads });
  } catch (e) {
    console.error("ADMIN CHAT THREADS ERROR:", e);
    res.status(500).json({ message: "Failed to load chat threads" });
  }
});

// ✅ GET /api/admin/chats/threads/:threadId/messages
// Returns { items: [...] } as expected by admin UI
router.get("/threads/:threadId/messages", protect, adminOnly, async (req, res) => {
  try {
    const { threadId } = req.params;

    const items = await ChatMessage.find({ threadId })
      .populate({ path: "sender", select: "name role" })
      .sort({ createdAt: 1 })
      .limit(2000);

    res.json({ items });
  } catch (e) {
    console.error("ADMIN CHAT MESSAGES ERROR:", e);
    res.status(500).json({ message: "Failed to load chat messages" });
  }
});

module.exports = router;