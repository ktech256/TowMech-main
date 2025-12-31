import nodemailer from "nodemailer";

/**
 * ✅ Sends Job Accepted Email
 * @param {Object} args
 * args.to = customer email
 * args.name = customer name
 * args.job = full job object (populated)
 */
export const sendJobAcceptedEmail = async ({ to, name, job }) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const providerName = job.assignedTo?.name || "Provider";
    const pickup = job.pickupAddressText || "Pickup not provided";
    const dropoff = job.dropoffAddressText || "Dropoff not provided";

    const subject = "✅ Your TowMech Job Has Been Accepted";

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #1E2A5E;">Job Accepted ✅</h2>

        <p>Hello <b>${name}</b>,</p>

        <p>Your service request has been accepted by <b>${providerName}</b>.</p>
        <p>The provider is now on the way.</p>

        <hr />

        <h3>📌 Job Summary</h3>
        <p><b>Job Title:</b> ${job.title}</p>
        <p><b>Pickup:</b> ${pickup}</p>
        <p><b>Dropoff:</b> ${dropoff}</p>
        <p><b>Status:</b> ${job.status}</p>

        <hr />

        <p style="font-size: 13px; color: gray;">
          Thank you for using TowMech.<br/>
          Killian Digital Solutions © ${new Date().getFullYear()}
        </p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"TowMech" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html
    });

    console.log("✅ Job Accepted Email sent:", info.messageId);
    return true;
  } catch (err) {
    console.error("❌ Job Accepted Email failed:", err.message);
    return false;
  }
};