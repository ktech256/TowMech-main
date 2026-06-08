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
 * Business Rule: Payouts can ONLY be processed on Tuesday 08:00 AM - 04:00 PM
 */
export async function markPayoutAsPaid(payoutId, adminId) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const hour = now.getHours();

  // Tuesday check
  if (day !== 2 || hour < 8 || hour >= 16) {
    throw new Error(
      "Payouts can only be processed on Tuesdays between 08:00 AM and 04:00 PM (Local Server Time)."
    );
  }

  const payout = await WeeklyPayout.findById(payoutId).populate("provider");
  if (!payout) throw new Error("Payout not found");
  if (payout.status === "PAID") throw new Error("Payout already paid");

  payout.status = "PAID";
  payout.paidAt = new Date();
  payout.paidBy = adminId;

  // ✅ AUDIT TRAIL: Add history entry
  const historyEntry = {
    action: "PAID",
    performedBy: adminId,
    timestamp: new Date(),
    note: "Payout marked as paid via Admin Dashboard",
  };

  if (!payout.auditTrail) payout.auditTrail = [];
  payout.auditTrail.push(historyEntry);

  await payout.save();

  // Send Notifications
  const provider = payout.provider;
  if (provider && provider.email) {
    const fromStr = payout.weekStartDate.toISOString().split("T")[0];
    const toStr = payout.weekEndDate.toISOString().split("T")[0];
    const amountStr = `${payout.currency} ${payout.totalAmount.toFixed(2)}`;

    const notificationText = `Your payout of ${amountStr}\nfor period ${fromStr} to ${toStr}\nhas been processed.\nStandard transfer cutoff times apply.`;

    // 1. Email (Attach simulated invoice link)
    const invoiceLink = `https://towmech.com/payouts/invoice/${payout._id}`;
    await sendEmail({
      to: provider.email,
      subject: "Payout Processed ✅",
      text: `Hello ${provider.name},\n\n${notificationText}\n\nYou can view your statement here: ${invoiceLink}`,
    });

    // 2. Push Notification
    if (provider.fcmToken || provider.providerProfile?.fcmToken) {
      await sendPushToManyUsers({
        userIds: [provider._id],
        title: "Payout Processed 💰",
        body: notificationText,
      });
    }

    // 3. SMS (Mock/Logic)
    console.log(`[SMS MOCK] To ${provider.phone}:\n${notificationText}`);
  }

  return payout;
}