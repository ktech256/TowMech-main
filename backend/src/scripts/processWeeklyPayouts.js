// backend/src/scripts/processWeeklyPayouts.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import User, { USER_ROLES } from "../models/User.js";
import { syncProviderWeeklyPayout, getWeekRange } from "../services/payout.service.js";

dotenv.config();

/**
 * ✅ This script should be run every Monday (cron job)
 * It calculates earnings for the PREVIOUS week.
 */
async function run() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/towmech";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // We calculate for LAST week
    const lastWeekDate = new Date();
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const { start } = getWeekRange(lastWeekDate);

    console.log(`📊 Processing Weekly Payouts for start date: ${start.toISOString()}`);

    const providers = await User.find({
      role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
      "accountStatus.isArchived": { $ne: true }
    }).select("_id name");

    console.log(`🔍 Found ${providers.length} providers to check.`);

    let syncCount = 0;
    for (const p of providers) {
      const payout = await syncProviderWeeklyPayout(p._id, start);
      if (payout) {
        syncCount++;
        console.log(`✅ Synced payout for ${p.name}: ${payout.currency} ${payout.totalAmount}`);
      }
    }

    console.log(`🏁 Finished. Total payouts generated/synced: ${syncCount}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Process failed:", err);
    process.exit(1);
  }
}

run();