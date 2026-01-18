// server.js
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";

import app from "./app.js";
import connectDB from "./config/db.js";

// ✅ Socket bootstrap (File 7)
import { createSocketServer } from "./socket/index.js";

// ✅ get current file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ FORCE LOAD backend/.env
dotenv.config({ path: path.join(__dirname, "../.env") });

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    console.log("✅ server.js started");
    console.log(
      "✅ ENV CHECK:",
      process.env.MONGODB_URI ? "Loaded ✅" : "Missing ❌"
    );

    await connectDB();
    console.log("✅ DB connected");

    // ✅ Create HTTP server (required for Socket.IO)
    const httpServer = http.createServer(app);

    // ✅ Attach Socket.IO
    const io = createSocketServer(httpServer);

    // ✅ Make io available inside routes: req.app.get("io")
    app.set("io", io);

    httpServer.listen(PORT, () => {
      console.log(`✅ TowMech API running on http://localhost:${PORT}`);
      console.log("✅ Socket.IO enabled");
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
})();