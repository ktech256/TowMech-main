import crypto from "crypto";
import { sendEmail } from "../utils/sendEmail.js";
import { getInvitationEmailTemplate } from "./PartnerEmailTemplateService.js";
import { logAuditEvent } from "../utils/auditLogger.js";

/**
 * ✅ PartnerInvitationService
 * Handles the logic for generating tokens and sending invitations
 */
export const sendPartnerInvitation = async (req, partner) => {
  try {
    const activationToken = crypto.randomBytes(32).toString("hex");
    const expiryHours = 24;
    const activationTokenExpiry = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    partner.activationToken = activationToken;
    partner.activationTokenExpiry = activationTokenExpiry;
    partner.invitationStatus = "Sent";
    partner.lastInvitationSent = new Date();
    await partner.save();

    const portalSubdomain = partner.type === "INSURANCE" ? "insurance" : "fleet";
    const activationLink = `https://${portalSubdomain}.towmech.com/activate?token=${activationToken}`;

    const html = getInvitationEmailTemplate({
      partnerName: partner.name,
      partnerType: partner.type,
      partnerCode: partner.partnerCode,
      activationLink,
      expiryHours
    });

    const emailSent = await sendEmail({
      to: partner.contactEmail,
      subject: "TowMech Partner Portal Invitation",
      html
    });

    if (emailSent) {
      partner.invitationStatus = "Delivered";
      await partner.save();

      await logAuditEvent(req, {
        action: "INVITATION_SENT",
        entityType: "PARTNER",
        entityId: partner._id,
        details: {
          recipient: partner.contactEmail,
          type: partner.type
        }
      });
    } else {
      partner.invitationStatus = "Not Sent";
      await partner.save();

      await logAuditEvent(req, {
        action: "INVITATION_FAILED",
        entityType: "PARTNER",
        entityId: partner._id,
        details: {
          recipient: partner.contactEmail,
          reason: "SMTP Failure"
        }
      });

      throw new Error("SMTP failed to send invitation");
    }

    return true;
  } catch (err) {
    console.error("❌ Partner invitation failed:", err.message);
    return false;
  }
};
