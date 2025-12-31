import nodemailer from "nodemailer";

let transporter = null;

/**
 * ✅ Create and reuse transporter
 */
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
  return transporter;
};

/**
 * ✅ Generic email sender
 * @param {Object} args
 * args.to = recipient email
 * args.subject = email subject
 * args.html = email HTML body
 */
export const sendEmail = async ({ to, subject, html }) => {
  try {
    const transporter = getTransporter();

    const info = await transporter.sendMail({
      from: `"TowMech" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html
    });

    console.log("✅ Email sent:", info.messageId);
    return true;
  } catch (err) {
    console.error("❌ Email send failed:", err.message);
    return false;
  }
};