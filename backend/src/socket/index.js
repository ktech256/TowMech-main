// /backend/src/socket/index.js
import { Server } from "socket.io";
import { registerChatSocket } from "./chatSocket.js";

/**
 * ✅ createSocketServer(httpServer)
 * - attaches Socket.IO to your existing HTTP server
 */
export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    },
  });

  registerChatSocket(io);

  return io;
}