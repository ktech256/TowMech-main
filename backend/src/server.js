import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import app from "./app.js";
import connectDB from "./config/db.js";

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

    app.listen(PORT, () => {
      console.log(`✅ TowMech API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
})();