import { EmailService } from "../services/EmailService.js";

/**
 * ✅ Sends Job Completed Email (SendGrid Migration)
 */
export const sendJobCompletedEmail = async ({ to, name, job, recipientType }) => {
  try {
    return await EmailService.sendJobNotification(null, {
      to,
      name,
      title: job.title,
      status: job.status,
      pickup: job.pickupAddressText || "Pickup not provided",
      dropoff: job.dropoffAddressText || "Dropoff not provided",
      type: "completed"
    });
  } catch (err) {
    console.error("❌ Job Completed Email failed:", err.message);
    return false;
  }
};