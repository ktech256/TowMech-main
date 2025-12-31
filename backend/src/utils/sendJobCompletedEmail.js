import { sendEmail } from "./sendEmail.js";

/**
 * ✅ Sends Job Completed Email
 * @param {Object} args
 * args.to = recipient email
 * args.name = recipient name
 * args.job = full job object
 * args.recipientType = "CUSTOMER" or "PROVIDER"
 */
export const sendJobCompletedEmail = async ({ to, name, job, recipientType }) => {
  try {
    const currency = job.pricing?.currency || "ZAR";
    const estimatedTotal = job.pricing?.estimatedTotal || 0;
    const bookingFee = job.pricing?.bookingFee || 0;
    const providerAmountDue = job.pricing?.providerAmountDue || 0;

    const pickup = job.pickupAddressText || "Pickup not provided";
    const dropoff = job.dropoffAddressText || "Dropoff not provided";

    const subject =
      recipientType === "CUSTOMER"
        ? "✅ Your TowMech Job Has Been Completed"
        : "✅ Job Completed Successfully (TowMech)";

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #1E2A5E;">TowMech Job Completed ✅</h2>

        <p>Hello <b>${name}</b>,</p>

        <p>
          ${
            recipientType === "CUSTOMER"
              ? "Your request has been completed successfully."
              : "You have successfully completed a job."
          }
        </p>

        <hr />

        <h3>📌 Job Summary</h3>
        <p><b>Job Title:</b> ${job.title}</p>
        <p><b>Status:</b> ${job.status}</p>
        <p><b>Pickup:</b> ${pickup}</p>
        <p><b>Dropoff:</b> ${dropoff}</p>

        <h3>💰 Payment Summary</h3>
        <p><b>Estimated Total:</b> ${currency} ${estimatedTotal}</p>
        <p><b>Booking Fee Paid:</b> ${currency} ${bookingFee}</p>
        <p><b>Provider Amount Due:</b> ${currency} ${providerAmountDue}</p>

        <hr />

        <p style="font-size: 13px; color: gray;">
          Thank you for using TowMech.<br/>
          Killian Digital Solutions © ${new Date().getFullYear()}
        </p>
      </div>
    `;

    // ✅ Use reusable sendEmail function
    return await sendEmail({ to, subject, html });

  } catch (err) {
    console.error("❌ Job Completed Email failed:", err.message);
    return false;
  }
};