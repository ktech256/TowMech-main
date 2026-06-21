/**
 * ✅ PartnerEmailTemplateService
 * Generates HTML templates for Partner related emails
 */
export const getInvitationEmailTemplate = ({ partnerName, partnerType, partnerCode, activationLink, expiryHours }) => {
  return `
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
      <p style="font-size: 12px; color: #999; text-align: center;">&copy; 2026 TowMech. All rights reserved.</p>
    </div>
  `;
};

export const getOtpEmailTemplate = ({ otp }) => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
      <h2 style="color: #FF8C00;">TowMech Login Verification</h2>
      <p>Your 6-digit login OTP is:</p>
      <div style="text-align: center; margin: 30px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #333; background: #f0f0f0; padding: 10px 20px; border-radius: 5px;">${otp}</span>
      </div>
      <p>This code expires in 10 minutes. If you did not request this, please secure your account.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">&copy; 2026 TowMech. All rights reserved.</p>
    </div>
  `;
};
