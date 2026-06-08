// backend/src/scripts/cleanupInactiveProviders.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";

dotenv.config();

const HEARTBEAT_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes (gives buffer for 2-3 min heartbeat)

async function run() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/towmech";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    const timeoutDate = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

    // Find online providers who haven't sent a heartbeat recently
    const inactiveProviders = await User.find({
      role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
      "providerProfile.isOnline": true,
      $or: [
        { "providerProfile.lastHeartbeatAt": { $lt: timeoutDate } },
        { "providerProfile.lastHeartbeatAt": { $exists: false } }
      ]
    }).select("_id name providerProfile");

    console.log(`🔍 Found ${inactiveProviders.length} inactive online providers.`);

    let offlineCount = 0;
    for (const p of inactiveProviders) {
      // Safety: check if they have an active job.
      // If they have an active job, we MIGHT want to keep them online but flag them as unresponsive.
      // However, per requirements, "Provider must automatically become OFFLINE".
      // We will allow offline if the app died, even if they have an active job,
      // because we can't dispatch to them anyway if they are dead.

      p.providerProfile.isOnline = false;
      await p.save();
      offlineCount++;
      console.log(`📵 Marked ${p.name} as OFFLINE (timeout)`);
    }

    console.log(`🏁 Finished. Total providers marked offline: ${offlineCount}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Cleanup failed:", err);
    process.exit(1);
  }
}

run();