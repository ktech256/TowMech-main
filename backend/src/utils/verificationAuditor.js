import User, { USER_ROLES } from "../models/User.js";
import Notification from "../models/Notification.js";
import { sendPushToUser } from "./sendPush.js";

/**
 * ✅ Helper to notify user via Push + In-App
 */
async function notifyProvider(userId, title, body, type = "VERIFICATION") {
  try {
    // 1. Send Push
    await sendPushToUser({ userId, title, body, data: { type } });

    // 2. Save In-App Notification
    await Notification.create({
      userId,
      title,
      body,
      type
    });
  } catch (err) {
    console.error(`[AUDITOR] Notify error for ${userId}:`, err.message);
  }
}

/**
 * ✅ Run Daily Verification Audit
 */
export async function runVerificationAudit() {
  console.log("[AUDITOR] Starting daily verification audit...");
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const providers = await User.find({
    role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
    "providerProfile.verificationStatus": "APPROVED"
  });

  for (const provider of providers) {
    const docs = provider.providerProfile.verificationDocs;
    if (!docs) continue;

    let changed = false;

    const docFields = Object.keys(docs);
    for (const field of docFields) {
      const doc = docs[field];
      if (!doc || doc.expiryType !== "HAS_EXPIRY" || !doc.expiryDate) continue;

      const expiry = new Date(doc.expiryDate);
      const graceEnd = doc.gracePeriodEnd ? new Date(doc.gracePeriodEnd) : new Date(expiry.getTime() + 7 * 24 * 60 * 60 * 1000);

      // 1. Check for 7-day warning
      if (expiry > now && expiry <= sevenDaysFromNow && doc.status !== "EXPIRED") {
         await notifyProvider(
           provider._id,
           "Document Expiring Soon ⚠️",
           `Your ${formatFieldLabel(field)} will expire on ${expiry.toLocaleDateString()}. Please upload a replacement.`,
           "EXPIRY"
         );
      }

      // 2. Check for Expiry
      if (expiry <= now && doc.status !== "EXPIRED") {
        doc.status = "EXPIRED";
        doc.expiredAt = now;
        doc.gracePeriodEnd = graceEnd;
        changed = true;

        await notifyProvider(
            provider._id,
            "Document Expired ❌",
            `Your ${formatFieldLabel(field)} has expired. You have a 7-day grace period to upload a replacement.`,
            "EXPIRY"
        );
      }
    }

    if (changed) {
      provider.markModified("providerProfile.verificationDocs");
      await provider.save();
    }
  }

  console.log("[AUDITOR] Verification audit complete.");
}

function formatFieldLabel(field) {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
}

