import { EmailService } from "../services/EmailService.js";

/**
 * ✅ Sends Job Accepted Email (SendGrid Migration)
 */
export const sendJobAcceptedEmail = async ({ to, name, job }) => {
  try {
    return await EmailService.sendJobNotification(null, {
      to,
      name,
      title: job.title,
      status: job.status,
      pickup: job.pickupAddressText || "Pickup not provided",
      dropoff: job.dropoffAddressText || "Dropoff not provided",
      type: "accepted"
    });
  } catch (err) {
    console.error("❌ Job Accepted Email failed:", err.message);
    return false;
  }
};