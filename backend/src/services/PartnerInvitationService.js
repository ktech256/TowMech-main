import crypto from "crypto";
import { EmailService } from "./EmailService.js";
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

    const emailSent = await EmailService.sendPartnerInvitation(req, {
      to: partner.contactEmail,
      partnerName: partner.name,
      partnerType: partner.type,
      partnerCode: partner.partnerCode,
      activationLink,
      expiryHours
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
          reason: "SendGrid Failure"
        }
      });

      throw new Error("SendGrid failed to send invitation");
    }

    return true;
  } catch (err) {
    console.error("❌ Partner invitation failed:", err.message);
    return false;
  }
};
