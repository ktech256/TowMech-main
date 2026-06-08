import WeeklyPayout from "../models/WeeklyPayout.js";
import Job from "../models/Job.js";
import User from "../models/User.js";
import { JOB_STATUSES } from "../models/Job.js";
import { sendEmail } from "../utils/sendEmail.js";
import { sendPushToManyUsers } from "../utils/sendPush.js";

/**
 * ✅ Get start and end of week (Monday to Monday)
 */
export function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return { start, end };
}

/**
 * ✅ Calculate and sync payout for a provider for a specific week
 */
export async function syncProviderWeeklyPayout(providerId, weekStartDate) {
  const { start, end } = getWeekRange(weekStartDate);

  // Find all COMPLETED INSURANCE jobs for this provider in this range
  const jobs = await Job.find({
    assignedTo: providerId,
    status: JOB_STATUSES.COMPLETED,
    "insurance.enabled": true,
    updatedAt: { $gte: start, $lt: end }
  });

  if (jobs.length === 0) return null;

  const user = await User.findById(providerId);
  const countryCode = user.countryCode || "ZA";
  const currency = jobs[0].pricing?.currency || "ZAR";

  let totalAmount = 0;
  const dailyBreakdown = new Map();
  const jobList = [];

  jobs.forEach(job => {
    const amount = job.pricing?.providerAmountDue || 0;
    totalAmount += amount;

    const dateKey = job.updatedAt.toISOString().split('T')[0];
    const currentDayAmount = dailyBreakdown.get(dateKey) || 0;
    dailyBreakdown.set(dateKey, currentDayAmount + amount);

    jobList.push({
      job: job._id,
      amount,
      completedAt: job.updatedAt
    });
  });

  const payout = await WeeklyPayout.findOneAndUpdate(
    { provider: providerId, weekStartDate: start },
    {
      countryCode,
      weekEndDate: end,
      dailyBreakdown,
      jobs: jobList,
      totalAmount,
      currency,
      processedAt: new Date()
    },
    { upsert: true, new: true }
  );

  return payout;
}

/**
 * ✅ Admin marks payout as PAID
 */
export async function markPayoutAsPaid(payoutId, adminId) {
  const payout = await WeeklyPayout.findById(payoutId).populate("provider");
  if (!payout) throw new Error("Payout not found");
  if (payout.status === "PAID") throw new Error("Payout already paid");

  payout.status = "PAID";
  payout.paidAt = new Date();
  payout.paidBy = adminId;
  await payout.save();

  // Send Notifications
  const provider = payout.provider;
  if (provider && provider.email) {
    const periodStr = `${payout.weekStartDate.toLocaleDateString()} -> ${payout.weekEndDate.toLocaleDateString()}`;

    // 1. Email
    await sendEmail({
      to: provider.email,
      subject: "Your Weekly Payout has been processed",
      text: `Hello ${provider.name}, your payout of ${payout.currency} ${payout.totalAmount} for period ${periodStr} has been processed. Standard transfer cutoff times apply.`
    });

    // 2. Push Notification
    if (provider.fcmToken) {
        await sendPushToManyUsers({
            userIds: [provider._id],
            title: "Payout Processed 💰",
            body: `Your payout of ${payout.currency} ${payout.totalAmount} has been marked as PAID.`
        });
    }

    // 3. SMS (Mock/Logic)
    console.log(`[SMS MOCK] To ${provider.phone}: Your payout of ${payout.currency} ${payout.totalAmount} for period ${periodStr} has been processed. Standard transfer cutoff times apply.`);
  }

  return payout;
}