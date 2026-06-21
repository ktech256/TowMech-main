import { EmailService } from "../services/EmailService.js";

/**
 * ✅ Generic email sender (SendGrid Migration)
 * @param {Object} args
 * args.to = recipient email
 * args.subject = email subject
 * args.html = email HTML body
 */
export const sendEmail = async ({ to, subject, html }) => {
  // Use the new centralized EmailService
  return await EmailService.send(null, { to, subject, html });
};