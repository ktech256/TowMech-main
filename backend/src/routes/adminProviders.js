// backend/src/routes/adminProviders.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import Notification from "../models/Notification.js";
import { sendPushToUser } from "../utils/sendPush.js";
import { verifyFaces } from "../utils/faceVerification.js";
import { logAuditEvent } from "../utils/auditLogger.js";

const router = express.Router();

/**
 * ✅ Helper to notify user via Push + In-App
 */
async function notifyProvider(userId, title, body, type = "VERIFICATION") {
  try {
    await sendPushToUser({ userId, title, body, data: { type } });
    await Notification.create({ userId, title, body, type });
  } catch (err) {
    console.error(`[ADMIN] Notify error for ${userId}:`, err.message);
  }
}

/**
 * ✅ Resolve active workspace country (Tenant)
 */
const resolveCountryCode = (req) => {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query?.country ||
    req.query?.countryCode ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Enforce country workspace rules (same as adminUsers)
 * - SuperAdmin can view any workspace
 * - Admin can only view:
 *    - their own country workspace
 *    - OR any workspace IF canSwitchCountryWorkspace=true
 *
 * ✅ If admin cannot switch, FORCE workspaceCountryCode to user.countryCode.
 */
const enforceWorkspaceAccess = (req, res, workspaceCountryCode) => {
  const role = req.user?.role;
  const userCountry = String(req.user?.countryCode || "ZA").toUpperCase();
  const canSwitch = !!req.user?.permissions?.canSwitchCountryWorkspace;

  if (role === USER_ROLES.SUPER_ADMIN) {
    req.countryCode = workspaceCountryCode;
    return true;
  }

  if (role === USER_ROLES.ADMIN && !canSwitch) {
    req.countryCode = userCountry; // 🔒 force lock
    return true;
  }

  req.countryCode = workspaceCountryCode;
  return true;
};

/**
 * ✅ Permission enforcement helper
 */
const requirePermission = (req, res, permissionKey) => {
  if (req.user.role === USER_ROLES.SUPER_ADMIN) return true;

  if (req.user.role === USER_ROLES.ADMIN) {
    if (!req.user.permissions || req.user.permissions[permissionKey] !== true) {
      res.status(403).json({
        message: `Permission denied ❌ Missing ${permissionKey}`,
      });
      return false;
    }
    return true;
  }

  res.status(403).json({ message: "Permission denied ❌" });
  return false;
};

/**
 * ✅ Block Suspended / Banned admins from doing actions
 */
const blockRestrictedAdmins = (req, res) => {
  if (req.user.accountStatus?.isSuspended) {
    res.status(403).json({ message: "Your admin account is suspended ❌" });
    return true;
  }
  if (req.user.accountStatus?.isBanned) {
    res.status(403).json({ message: "Your admin account is banned ❌" });
    return true;
  }
  return false;
};

/**
 * ✅ Block verification actions on archived / banned / suspended providers
 */
const blockInvalidProvider = (provider, res) => {
  const status = provider.accountStatus || {};
  if (status.isArchived) {
    res.status(400).json({ message: "Provider is archived ❌ Cannot verify" });
    return true;
  }
  if (status.isSuspended) {
    res.status(400).json({ message: "Provider is suspended ❌ Cannot verify" });
    return true;
  }
  if (status.isBanned) {
    res.status(400).json({ message: "Provider is banned ❌ Cannot verify" });
    return true;
  }
  return false;
};

/**
 * ✅ Admin fetches providers needing verification (PER COUNTRY)
 * GET /api/admin/providers/providers/pending
 */
router.get(
  "/providers/pending",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const { minRating, maxRating } = req.query;
      const query = {
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": { $ne: "APPROVED" },
        "accountStatus.isArchived": { $ne: true },
      };

      if (minRating || maxRating) {
        query["ratingStats.asProvider.avg"] = {
          $gte: Number(minRating) || 0,
          $lte: Number(maxRating) || 5
        };
      }

      const providers = await User.find(query)
        .select("name email role countryCode providerProfile identificationType identificationNumber passportCountry verifiedCountry partnerId ratingStats createdAt accountStatus")
        .populate("providerProfile.verifiedBy", "name email role")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        providers: providers.map((p) => p.toSafeJSON(req.user.role)),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch pending providers",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin fetches APPROVED providers (PER COUNTRY)
 * GET /api/admin/providers/providers/approved
 */
router.get(
  "/providers/approved",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const { minRating, maxRating } = req.query;
      const query = {
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": "APPROVED",
        "accountStatus.isArchived": { $ne: true },
      };

      if (minRating || maxRating) {
        query["ratingStats.asProvider.avg"] = {
          $gte: Number(minRating) || 0,
          $lte: Number(maxRating) || 5
        };
      }

      const providers = await User.find(query)
        .select("name email role countryCode providerProfile identificationType identificationNumber passportCountry verifiedCountry partnerId ratingStats createdAt accountStatus")
        .populate("providerProfile.verifiedBy", "name email role")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        providers: providers.map((p) => p.toSafeJSON(req.user.role)),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch approved providers",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin fetches REJECTED providers (PER COUNTRY)
 * GET /api/admin/providers/providers/rejected
 */
router.get(
  "/providers/rejected",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const { minRating, maxRating } = req.query;
      const query = {
        countryCode: workspaceCountryCode,
        role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] },
        "providerProfile.verificationStatus": "REJECTED",
        "accountStatus.isArchived": { $ne: true },
      };

      if (minRating || maxRating) {
        query["ratingStats.asProvider.avg"] = {
          $gte: Number(minRating) || 0,
          $lte: Number(maxRating) || 5
        };
      }

      const providers = await User.find(query)
        .select("name email role countryCode providerProfile identificationType identificationNumber passportCountry verifiedCountry partnerId ratingStats createdAt accountStatus")
        .populate("providerProfile.verifiedBy", "name email role")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        providers: providers.map((p) => p.toSafeJSON(req.user.role)),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch rejected providers",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin views a provider's verification documents (PER COUNTRY)
 * GET /api/admin/providers/providers/:id/verification
 */
router.get(
  "/providers/:id/verification",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      console.log(`[VERIFICATION_TRACE] Admin fetching verification for provider: ${req.params.id}`);

      const provider = await User.findById(req.params.id)
        .select(
          "name firstName lastName email role countryCode providerProfile identificationType identificationNumber passportCountry verifiedCountry saIdNumber passportNumber partnerId ratingStats accountStatus"
        )
        .populate("partnerId", "name type partnerCode")
        .populate("providerProfile.verifiedBy", "name email role");

      if (!provider) {
        console.error(`[VERIFICATION_TRACE] Provider not found: ${req.params.id}`);
        return res.status(404).json({ message: "Provider not found" });
      }

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        String(provider.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "Provider not found" });
      }

      console.log(`[VERIFICATION_TRACE] Docs found: ${!!provider.providerProfile?.verificationDocs}`);
      if (provider.providerProfile?.verificationDocs) {
        Object.keys(provider.providerProfile.verificationDocs).forEach(k => {
          if (provider.providerProfile.verificationDocs[k]?.url) {
            console.log(`[VERIFICATION_TRACE] - ${k}: PENDING/SUBMITTED`);
          }
        });
      }

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        provider: provider.toSafeJSON(req.user.role),
        verificationStatus: provider.providerProfile?.verificationStatus,
        verificationDocs: provider.providerProfile?.verificationDocs || {},
      });
    } catch (err) {
      console.error(`[VERIFICATION_TRACE] ERROR: ${err.message}`, err);
      return res.status(500).json({
        message: "Could not fetch verification docs",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin approves provider
 * PATCH /api/admin/providers/providers/:id/approve
 */
router.patch(
  "/providers/:id/approve",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (![USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC].includes(provider.role)) {
        return res.status(400).json({ message: "Target user is not a provider ❌" });
      }

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        String(provider.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "Provider not found" });
      }

      if (blockInvalidProvider(provider, res)) return;

      if (!provider.providerProfile) provider.providerProfile = {};
      provider.providerProfile.verificationStatus = "APPROVED";
      provider.providerProfile.verifiedAt = new Date();
      provider.providerProfile.verifiedBy = req.user._id;

      // Phase 9: Country Synchronization Fix
      if (provider.identificationType === "SA_ID") {
          provider.verifiedCountry = "South Africa";
      } else if (provider.identificationType === "PASSPORT") {
          provider.verifiedCountry = provider.passportCountry;
      }

      await provider.save();
      await provider.populate("providerProfile.verifiedBy", "name email role");

      return res.status(200).json({
        message: "Provider approved successfully ✅",
        provider: provider.toSafeJSON(req.user.role),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not approve provider",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin rejects provider
 * PATCH /api/admin/providers/providers/:id/reject
 */
router.patch(
  "/providers/:id/reject",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (![USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC].includes(provider.role)) {
        return res.status(400).json({ message: "Target user is not a provider ❌" });
      }

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        String(provider.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "Provider not found" });
      }

      if (blockInvalidProvider(provider, res)) return;

      if (!provider.providerProfile) provider.providerProfile = {};
      provider.providerProfile.verificationStatus = "REJECTED";
      provider.providerProfile.verifiedAt = new Date();
      provider.providerProfile.verifiedBy = req.user._id;

      await provider.save();

      return res.status(200).json({
        message: "Provider rejected successfully ✅",
        provider: provider.toSafeJSON(req.user.role),
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not reject provider",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Phase 6: Individual Document Approval
 * PATCH /api/admin/providers/providers/:id/documents/:field/approve
 */
router.patch(
  "/providers/:id/documents/:field/approve",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const { id, field } = req.params;
      const { asType } = req.body; // Phase 8: ID Type Enforcement
      console.log(`[VERIFICATION_TRACE] Approving document: ${field} for provider: ${id}`);

      const provider = await User.findById(id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (!provider.providerProfile.verificationDocs[field]) {
        return res.status(400).json({ message: `Document ${field} not found` });
      }

      // Phase 8: Identification Consistency Enforcement
      if (field === "idDocument") {
        if (provider.identificationType === "SA_ID" && asType !== "SA_ID") {
          return res.status(400).json({
            message: "Provider registered using South African ID. Passport document cannot be approved.",
            code: "ID_TYPE_MISMATCH"
          });
        }
        if (provider.identificationType === "PASSPORT" && asType !== "PASSPORT") {
          return res.status(400).json({
            message: "Provider registered using Passport. South African ID cannot be approved.",
            code: "ID_TYPE_MISMATCH"
          });
        }
      }

      provider.providerProfile.verificationDocs[field].status = "APPROVED";
      provider.providerProfile.verificationDocs[field].updatedAt = new Date();
      provider.providerProfile.verificationDocs[field].reason = null;

      // If it's a selfie, update the profile photo
      if (field === "selfie") {
        provider.photoUrl = provider.providerProfile.verificationDocs[field].url;
      }

      provider.markModified(`providerProfile.verificationDocs.${field}`);
      await provider.save();
      console.log(`[VERIFICATION_TRACE] Approved ${field} for ${id}`);

      // Send Notification
      const fieldLabel = field.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
      await notifyProvider(
        provider._id,
        "Document Approved ✅",
        `Your ${fieldLabel} has been approved.`,
        "VERIFICATION"
      );

      return res.status(200).json({
        message: `${fieldLabel} approved ✅`,
        verificationDocs: provider.providerProfile.verificationDocs,
      });
    } catch (err) {
      console.error(`[VERIFICATION_TRACE] Approval ERROR: ${err.message}`);
      return res.status(500).json({ message: "Approval failed", error: err.message });
    }
  }
);

/**
 * ✅ Phase 6: Individual Document Rejection
 * PATCH /api/admin/providers/providers/:id/documents/:field/reject
 */
router.patch(
  "/providers/:id/documents/:field/reject",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const { id, field } = req.params;
      const { reason } = req.body;
      console.log(`[VERIFICATION_TRACE] Rejecting document: ${field} for provider: ${id}. Reason: ${reason}`);

      const provider = await User.findById(id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (!provider.providerProfile.verificationDocs[field]) {
        return res.status(400).json({ message: `Document ${field} not found` });
      }

      provider.providerProfile.verificationDocs[field].status = "REJECTED";
      provider.providerProfile.verificationDocs[field].updatedAt = new Date();
      provider.providerProfile.verificationDocs[field].reason = reason || "Incomplete or blurry.";

      // Overall status reverts to REJECTED if any required doc is rejected
      provider.providerProfile.verificationStatus = "REJECTED";

      provider.markModified(`providerProfile.verificationDocs.${field}`);
      await provider.save();
      console.log(`[VERIFICATION_TRACE] Rejected ${field} for ${id}`);

      // Send Notification
      const fieldLabel = field.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
      await notifyProvider(
        provider._id,
        "Document Rejected ❌",
        `Your ${fieldLabel} was rejected. Reason: ${provider.providerProfile.verificationDocs[field].reason}`,
        "VERIFICATION"
      );

      return res.status(200).json({
        message: `${fieldLabel} rejected ❌`,
        verificationDocs: provider.providerProfile.verificationDocs,
      });
    } catch (err) {
      console.error(`[VERIFICATION_TRACE] Rejection ERROR: ${err.message}`);
      return res.status(500).json({ message: "Rejection failed", error: err.message });
    }
  }
);

/**
 * ✅ Phase 6: Final Provider Approval
 * PATCH /api/admin/providers/providers/:id/final-approve
 */
router.patch(
  "/providers/:id/final-approve",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const { id } = req.params;
      console.log(`[VERIFICATION_TRACE] Final approve requested for provider: ${id}`);

      const provider = await User.findById(id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      const docs = provider.providerProfile.verificationDocs;
      const role = provider.role;
      const isCompanyVerified = docs?.companyVerification?.verificationSource === "COMPANY";

      // 🏢 Reduced document requirements for Company Drivers
      const commonRequired = isCompanyVerified
          ? ["idDocument", "selfie"]
          : ["idDocument", "driverLicense", "selfie", "huruCriminalCheck", "proofOfResidence"];

      // 🏢 Reduced vehicle requirements for Company Tow Trucks (often fleet-owned)
      const towTruckRequired = isCompanyVerified
          ? [] // Company fleets often verify their own vehicles
          : ["proofOfVehicle", "vehicleLicenseDisc"]; // RC1 remains optional

      const requiredFields = [...commonRequired];
      if (role === USER_ROLES.TOW_TRUCK) {
        requiredFields.push(...towTruckRequired);
      }

      const allApproved = requiredFields.every((f) => docs[f] && docs[f].status === "APPROVED");

      if (!allApproved) {
        console.warn(`[VERIFICATION_TRACE] Final approve denied for ${id}. Not all required docs approved.`);
        return res.status(400).json({
          message: "Cannot approve provider. Not all required documents are approved ❌",
          requiredFields,
        });
      }

      // Phase 8: Passport Country Check
      if (provider.identificationType === "PASSPORT" && !provider.passportCountry) {
          return res.status(400).json({
              message: "Cannot final approve. Passport country must be selected for passport holders.",
              code: "PASSPORT_COUNTRY_REQUIRED"
          });
      }

      provider.providerProfile.verificationStatus = "APPROVED";
      provider.providerProfile.verifiedAt = new Date();
      provider.providerProfile.verifiedBy = req.user._id;

      // Phase 9: Country Synchronization Fix
      if (provider.identificationType === "SA_ID") {
          provider.verifiedCountry = "South Africa";
      } else if (provider.identificationType === "PASSPORT") {
          provider.verifiedCountry = provider.passportCountry;
      }

      await provider.save();
      await provider.populate("providerProfile.verifiedBy", "name email role");
      console.log(`[VERIFICATION_TRACE] Final approve SUCCESS for ${id}`);

      // Send Notification
      await notifyProvider(
        provider._id,
        "Verification Complete 🎊",
        "Congratulations! Your verification is complete. You can now go online.",
        "VERIFICATION"
      );

      return res.status(200).json({
        message: "Provider fully verified successfully ✅",
        provider: provider.toSafeJSON(req.user.role),
      });
    } catch (err) {
      console.error(`[VERIFICATION_TRACE] Final Approval ERROR: ${err.message}`);
      return res.status(500).json({ message: "Final approval failed", error: err.message });
    }
  }
);

/**
 * ✅ Phase 7: Require Document Update
 * PATCH /api/admin/providers/providers/:id/documents/:field/require-update
 */
router.patch(
  "/providers/:id/documents/:field/require-update",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const { id, field } = req.params;
      const { reason } = req.body;
      console.log(`[VERIFICATION_TRACE] Requesting document update: ${field} for provider: ${id}. Reason: ${reason}`);

      const provider = await User.findById(id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (!provider.providerProfile.verificationDocs[field]) {
        provider.providerProfile.verificationDocs[field] = { status: "NOT_SUBMITTED" };
      }

      const doc = provider.providerProfile.verificationDocs[field];
      doc.status = "UPDATE_REQUIRED";
      doc.updateRequired = true;
      doc.updateReason = reason || "Please upload a valid document.";
      doc.updatedAt = new Date();

      provider.markModified(`providerProfile.verificationDocs.${field}`);
      await provider.save();

      // Send Notification
      const fieldLabel = field.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
      await notifyProvider(
        provider._id,
        "Document Update Required ⚠️",
        `Admin requested an update for your ${fieldLabel}. Reason: ${doc.updateReason}`,
        "VERIFICATION"
      );

      return res.status(200).json({
        message: `${fieldLabel} update requested ✅`,
        verificationDocs: provider.providerProfile.verificationDocs,
      });
    } catch (err) {
      console.error(`[VERIFICATION_TRACE] Update Request ERROR: ${err.message}`);
      return res.status(500).json({ message: "Update request failed", error: err.message });
    }
  }
);

/**
 * ✅ Phase 7: Set Document Expiry
 * PATCH /api/admin/providers/providers/:id/documents/:field/expiry
 */
router.patch(
  "/providers/:id/documents/:field/expiry",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const { id, field } = req.params;
      const { expiryDate, expiryType } = req.body;

      const provider = await User.findById(id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (!provider.providerProfile.verificationDocs[field]) {
        return res.status(400).json({ message: `Document ${field} not found` });
      }

      const doc = provider.providerProfile.verificationDocs[field];
      doc.expiryType = expiryType || "NA";
      doc.expiryDate = expiryDate ? new Date(expiryDate) : null;
      doc.updatedAt = new Date();

      provider.markModified(`providerProfile.verificationDocs.${field}`);
      await provider.save();

      return res.status(200).json({
        message: "Expiry updated ✅",
        verificationDocs: provider.providerProfile.verificationDocs,
      });
    } catch (err) {
      return res.status(500).json({ message: "Expiry update failed", error: err.message });
    }
  }
);

/**
 * ✅ Phase 8: Update Provider Identification Details
 * PATCH /api/admin/providers/providers/:id/identification
 */
router.patch(
  "/providers/:id/identification",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const { identificationType, identificationNumber, passportCountry } = req.body;
      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (identificationType) provider.identificationType = identificationType;
      if (identificationNumber) provider.identificationNumber = identificationNumber;
      if (passportCountry) provider.passportCountry = passportCountry;

      // Sync legacy fields
      if (provider.identificationType === "SA_ID") {
        provider.saIdNumber = provider.identificationNumber;
        provider.passportNumber = null;
        provider.passportCountry = null; // Clear country for SA ID users
        provider.verifiedCountry = "South Africa"; // Sync Phase 9
      } else if (provider.identificationType === "PASSPORT") {
        provider.passportNumber = provider.identificationNumber;
        provider.saIdNumber = null;
        provider.verifiedCountry = provider.passportCountry; // Sync Phase 9
      }

      await provider.save();

      return res.status(200).json({
        message: "Identification updated ✅",
        provider: provider.toSafeJSON(req.user.role),
      });
    } catch (err) {
      return res.status(500).json({ message: "Update failed", error: err.message });
    }
  }
);

/**
 * ✅ Phase 2: Manually Trigger Face Matching
 * PATCH /api/admin/providers/providers/:id/face-match
 */
router.patch(
  "/providers/:id/face-match",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      const idUrl = provider.providerProfile?.verificationDocs?.idDocument?.url;
      const selfieUrl = provider.providerProfile?.verificationDocs?.selfie?.url;

      if (!idUrl || !selfieUrl) {
        return res.status(400).json({ message: "ID Document and Selfie are required for matching ❌" });
      }

      const result = await verifyFaces(provider, idUrl, selfieUrl);
      await provider.save();

      return res.status(200).json({
        message: "Face matching intelligence updated ✅",
        faceMatching: result,
        verificationDocs: provider.providerProfile.verificationDocs
      });
    } catch (err) {
      return res.status(500).json({ message: "Face matching failed", error: err.message });
    }
  }
);

/**
 * ✅ Admin overrides OCR Intelligence results
 * PATCH /api/admin/providers/providers/:id/documents/idDocument/ocr-override
 */
router.patch(
    "/providers/:id/documents/idDocument/ocr-override",
    auth,
    authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    async (req, res) => {
        try {
            if (blockRestrictedAdmins(req, res)) return;
            if (!requirePermission(req, res, "canVerifyProviders")) return;

            const { detectedCountry, documentType, documentNumber, reason } = req.body;
            const provider = await User.findById(req.params.id);
            if (!provider) return res.status(404).json({ message: "Provider not found" });

            if (!provider.providerProfile?.verificationDocs?.idDocument) {
                return res.status(400).json({ message: "ID Document not found" });
            }

            const idDoc = provider.providerProfile.verificationDocs.idDocument;

            // Log the override (Preserve original data for audit)
            idDoc.ocrOverride = {
                originalData: {
                    detectedCountry: idDoc.detectedCountry,
                    documentType: idDoc.documentType,
                    documentNumber: idDoc.documentNumber
                },
                overriddenBy: req.user._id,
                overriddenByName: req.user.name,
                overriddenAt: new Date(),
                reason: reason || "Admin manual correction"
            };

            // Update display fields to overridden values
            if (detectedCountry) idDoc.detectedCountry = detectedCountry;
            if (documentType) idDoc.documentType = documentType;
            if (documentNumber) idDoc.documentNumber = documentNumber;

            idDoc.mismatchWarning = false; // Clear warning if admin manually fixed it

            // Sync with profile identification if appropriate
            if (idDoc.documentType === "ID") provider.identificationType = "SA_ID"; // default if ID
            if (idDoc.documentType === "PASSPORT") provider.identificationType = "PASSPORT";
            if (idDoc.documentNumber) provider.identificationNumber = idDoc.documentNumber;

            provider.markModified("providerProfile.verificationDocs.idDocument");
            await provider.save();

            return res.status(200).json({
                message: "OCR Intelligence overridden successfully ✅",
                verificationDocs: provider.providerProfile.verificationDocs
            });
        } catch (err) {
            return res.status(500).json({ message: "Override failed", error: err.message });
        }
    }
);

/**
 * ✅ Phase 3: Admin forces face verification for a provider
 * PATCH /api/admin/providers/providers/:id/force-face-check
 */
router.patch(
    "/providers/:id/force-face-check",
    auth,
    authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    async (req, res) => {
        try {
            if (blockRestrictedAdmins(req, res)) return;
            if (!requirePermission(req, res, "canVerifyProviders")) return;

            const provider = await User.findById(req.params.id);
            if (!provider) return res.status(404).json({ message: "Provider not found" });

            if (!provider.lastFaceCheck) provider.lastFaceCheck = {};
            provider.lastFaceCheck.isRequired = true;
            provider.markModified("lastFaceCheck");
            await provider.save();

            await logAuditEvent(req, {
                action: "FORCED_CHECK",
                entityType: "USER",
                entityId: provider._id,
                details: { adminName: req.user.name }
            });

            // Send push notification
            await notifyProvider(
                provider._id,
                "Identity Verification Required ⚠️",
                "An admin has requested an immediate identity verification. Please complete a face scan.",
                "SECURITY"
            );

            return res.status(200).json({ message: "Face verification forced successfully ✅" });
        } catch (err) {
            return res.status(500).json({ message: "Failed to force verification", error: err.message });
        }
    }
);

/**
 * ✅ Phase 3: Admin forces face verification for ALL providers in a country
 * PATCH /api/admin/providers/bulk/force-face-check
 */
router.patch(
    "/bulk/force-face-check",
    auth,
    authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    async (req, res) => {
        try {
            if (blockRestrictedAdmins(req, res)) return;
            if (!requirePermission(req, res, "canVerifyProviders")) return;

            const workspaceCountryCode = resolveCountryCode(req);
            if (!enforceWorkspaceAccess(req, res, workspaceCountryCode)) return;

            await User.updateMany(
                {
                    countryCode: workspaceCountryCode,
                    role: { $in: [USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC] }
                },
                { $set: { "lastFaceCheck.isRequired": true } }
            );

            await logAuditEvent(req, {
                action: "BULK_FORCED_CHECK",
                entityType: "COUNTRY",
                entityId: workspaceCountryCode,
                details: { adminName: req.user.name }
            });

            return res.status(200).json({ message: `Face verification forced for all providers in ${workspaceCountryCode} ✅` });
        } catch (err) {
            return res.status(500).json({ message: "Bulk force failed", error: err.message });
        }
    }
);

/**
 * ✅ Admin views a provider's Financial Scorecard (Phase 5)
 * GET /api/admin/providers/providers/:id/financials
 */
router.get(
  "/providers/:id/financials",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canVerifyProviders")) return;

      const requestedCountryCode = resolveReqCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const provider = await User.findById(req.params.id);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      if (
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        String(provider.countryCode || "").toUpperCase() !== workspaceCountryCode
      ) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Aggregations
      const completedJobs = await Job.find({
          assignedTo: provider._id,
          status: JOB_STATUSES.COMPLETED
      }).select("pricing createdAt updatedAt cancelledAt");

      const activeJobsCount = await Job.countDocuments({
          assignedTo: provider._id,
          status: { $in: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS] }
      });

      const cancelledCount = await Job.countDocuments({
          assignedTo: provider._id,
          status: JOB_STATUSES.CANCELLED,
          cancelledBy: provider._id // Only count if provider cancelled
      });

      const totalAssigned = await Job.countDocuments({ assignedTo: provider._id });
      const cancellationRate = totalAssigned > 0 ? (cancelledCount / totalAssigned) * 100 : 0;

      let weeklyEarnings = 0;
      let monthlyEarnings = 0;

      completedJobs.forEach(j => {
          const earnings = j.pricing?.providerAmountDue || 0;
          if (j.updatedAt >= weekStart) weeklyEarnings += earnings;
          if (j.updatedAt >= monthStart) monthlyEarnings += earnings;
      });

      return res.status(200).json({
          providerId: provider._id,
          weeklyEarnings,
          monthlyEarnings,
          activeJobs: activeJobsCount,
          completedJobs: completedJobs.length,
          cancellationRate: cancellationRate.toFixed(2),
          ratingTrend: provider.ratingStats?.asProvider?.avg || 0,
          currency: provider.countryCode === "ZA" ? "ZAR" : "USD" // Fallback simplified
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch financials",
        error: err.message,
      });
    }
  }
);

export default router;