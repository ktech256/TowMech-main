import sgMail from "@sendgrid/mail";
import { logAuditEvent } from "../utils/auditLogger.js";

// ✅ Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn("⚠️ SENDGRID_API_KEY is missing in environment variables");
}

const FROM_EMAIL = process.env.EMAIL_FROM || "noreply@towmech.com";
const FROM_NAME = process.env.EMAIL_FROM_NAME || "TowMech";

/**
 * ✅ Centralized Email Service
 */
export const EmailService = {
  /**
   * ✅ Generic Send Method
   */
  send: async (req, { to, subject, html, category = "notification" }) => {
    if (!process.env.SENDGRID_API_KEY) {
      console.error("❌ SendGrid skip: API Key missing");
      return false;
    }

    const msg = {
      to,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME,
      },
      subject,
      html,
      categories: [category],
    };

    try {
      const [response] = await sgMail.send(msg);

      if (req) {
        await logAuditEvent(req, {
          action: "EMAIL_SENT",
          entityType: "SYSTEM",
          entityId: req.user?._id || "SYSTEM",
          details: {
            recipient: to,
            subject,
            category,
            statusCode: response.statusCode,
            countryCode: req.countryCode || "UNKNOWN"
          }
        });
      }

      console.log(`✅ Email sent via SendGrid: ${to} | Status: ${response.statusCode}`);
      return true;
    } catch (err) {
      console.error("❌ SendGrid error:", err.message);
      if (err.response) {
        console.error("SendGrid response error body:", JSON.stringify(err.response.body));
      }

      if (req) {
        await logAuditEvent(req, {
          action: "EMAIL_FAILED",
          entityType: "SYSTEM",
          entityId: req.user?._id || "SYSTEM",
          details: {
            recipient: to,
            error: err.message,
            statusCode: err.code
          }
        });
      }
      return false;
    }
  },

  /**
   * ✅ Send Partner Invitation
   */
  sendPartnerInvitation: async (req, { to, partnerName, partnerType, partnerCode, activationLink, expiryHours }) => {
    const subject = "TowMech Partner Portal Invitation";
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: #FF8C00;">TowMech Partner Portal Invitation</h2>
        <p>Hello <strong>${partnerName}</strong>,</p>
        <p>You have been invited to join the TowMech Partner Ecosystem as a <strong>${partnerType}</strong> partner.</p>
        <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Partner Code:</strong> ${partnerCode}</p>
          <p style="margin: 5px 0;"><strong>Partner Type:</strong> ${partnerType}</p>
        </div>
        <p>To get started, please activate your account and create your password by clicking the button below:</p>
        <p style="text-align: center;">
          <a href="${activationLink}" style="background: #FF8C00; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Activate Account</a>
        </p>
        <p style="font-size: 12px; color: #666;">This link will expire in ${expiryHours} hours. If you did not expect this invitation, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} TowMech. All rights reserved.</p>
      </div>
    `;
    return EmailService.send(req, { to, subject, html, category: "invitation" });
  },

  /**
   * ✅ Send OTP
   */
  sendOtp: async (req, { to, otp }) => {
    const subject = "TowMech Login Verification";
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: #FF8C00;">TowMech Login Verification</h2>
        <p>Your 6-digit login OTP is:</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #333; background: #f0f0f0; padding: 10px 20px; border-radius: 5px;">${otp}</span>
        </div>
        <p>This code expires in 10 minutes. If you did not request this, please secure your account.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} TowMech. All rights reserved.</p>
      </div>
    `;
    return EmailService.send(req, { to, subject, html, category: "otp" });
  },

  /**
   * ✅ Send Password Reset
   */
  sendPasswordReset: async (req, { to, resetLink }) => {
    const subject = "TowMech Password Reset";
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: #FF8C00;">TowMech Password Reset</h2>
        <p>You requested to reset your password. Click the button below to proceed:</p>
        <p style="text-align: center;">
          <a href="${resetLink}" style="background: #FF8C00; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
        </p>
        <p style="font-size: 12px; color: #666;">This link will expire in 1 hour. If you did not request this, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} TowMech. All rights reserved.</p>
      </div>
    `;
    return EmailService.send(req, { to, subject, html, category: "password_reset" });
  },

  /**
   * ✅ Send Job Notification
   */
  sendJobNotification: async (req, { to, name, title, status, pickup, dropoff, type = "accepted" }) => {
    const subject = type === "accepted"
      ? "✅ Your TowMech Job Has Been Accepted"
      : "✅ Your TowMech Job Has Been Completed";

    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #FF8C00;">TowMech Job ${type === "accepted" ? "Accepted" : "Completed"} ✅</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Your service request <strong>"${title}"</strong> has been ${type}.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <div style="background: #f9f9f9; padding: 15px; border-radius: 8px;">
          <p style="margin: 5px 0;"><strong>Status:</strong> ${status}</p>
          <p style="margin: 5px 0;"><strong>Pickup:</strong> ${pickup}</p>
          <p style="margin: 5px 0;"><strong>Dropoff:</strong> ${dropoff}</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} TowMech. All rights reserved.</p>
      </div>
    `;
    return EmailService.send(req, { to, subject, html, category: "job_notification" });
  },

  /**
   * ✅ Send Account Verification Email
   */
  sendVerificationEmail: async (req, { to, name, verificationLink }) => {
    const subject = "TowMech Account Verification";
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: #FF8C00;">Verify Your TowMech Account</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Thank you for joining TowMech. Please verify your email address by clicking the button below:</p>
        <p style="text-align: center;">
          <a href="${verificationLink}" style="background: #FF8C00; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Verify Email</a>
        </p>
        <p style="font-size: 12px; color: #666;">If you did not create an account, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} TowMech. All rights reserved.</p>
      </div>
    `;
    return EmailService.send(req, { to, subject, html, category: "verification" });
  }
};
