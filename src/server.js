import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config/db.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    console.log("✅ server.js started");
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