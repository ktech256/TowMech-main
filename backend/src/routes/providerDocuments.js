import express from "express";
import multer from "multer";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import { uploadToFirebase } from "../utils/uploadToFirebase.js";

const router = express.Router();

// ✅ store file in memory
const upload = multer({ storage: multer.memoryStorage() });

/**
 * ✅ Provider uploads verification documents (Phase 6)
 * PATCH /api/providers/me/documents
 */
router.patch(
  "/me/documents",
  auth,
  upload.fields([
    { name: "idDocument", maxCount: 1 },
    { name: "driverLicense", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
    { name: "vehicleRC1", maxCount: 1 },
    { name: "huruCriminalCheck", maxCount: 1 },
    { name: "proofOfResidence", maxCount: 1 },
    { name: "proofOfVehicle", maxCount: 1 },
    { name: "vehicleLicenseDisc", maxCount: 1 },

    // backward compatibility
    { name: "idDocumentUrl", maxCount: 1 },
    { name: "licenseUrl", maxCount: 1 },
    { name: "vehicleProofUrl", maxCount: 1 },
    { name: "workshopProofUrl", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const userId = req.user._id;
      console.log(`[VERIFICATION_TRACE] Upload start for provider: ${userId}`);

      const user = await User.findById(userId);

      if (!user) {
        console.error(`[VERIFICATION_TRACE] User not found: ${userId}`);
        return res.status(404).json({ message: "User not found" });
      }

      console.log(`[VERIFICATION_TRACE] Provider Role: ${user.role}`);

      if (![USER_ROLES.TOW_TRUCK, USER_ROLES.MECHANIC].includes(user.role)) {
        return res
          .status(403)
          .json({ message: "Only providers can upload documents ❌" });
      }

      if (!user.providerProfile) user.providerProfile = {};
      if (!user.providerProfile.verificationDocs) {
        user.providerProfile.verificationDocs = {};
      }

      const files = req.files || {};
      console.log(`[VERIFICATION_TRACE] Files received: ${Object.keys(files).join(", ")}`);

      const uploadDoc = async (field) => {
        const file = files[field]?.[0];
        if (!file) return;

        console.log(`[VERIFICATION_TRACE] Processing field: ${field}`);
        const fileName = `providers/${user._id}/${field}-${Date.now()}`;
        const url = await uploadToFirebase(file.buffer, fileName, file.mimetype);
        console.log(`[VERIFICATION_TRACE] Firebase upload success for ${field}: ${url}`);

        // Move current to history if it exists and has a URL
        const current = user.providerProfile.verificationDocs[field];
        if (current && current.url) {
          if (!current.history) current.history = [];
          current.history.push({
            url: current.url,
            status: current.status,
            reason: current.reason,
            submittedAt: current.submittedAt,
            updatedAt: current.updatedAt,
            captureTimestamp: current.captureTimestamp,
          });
        }

        // Update current version
        const newDoc = {
          url,
          status: "PENDING",
          reason: null,
          submittedAt: new Date(),
          updatedAt: new Date(),
          captureTimestamp: req.body[`${field}Timestamp`] || new Date(),
          history: current?.history || [],

          // ✅ Phase 1: Smart ID Metadata (ID Document only for now)
          detectedCountry: field === "idDocument" ? req.body.idDetectedCountry : undefined,
          ocrText: field === "idDocument" ? req.body.idOcrText : undefined,
          documentNumber: field === "idDocument" ? req.body.idDocumentNumber : undefined,
          documentType: field === "idDocument" ? req.body.idDocumentType : undefined,
          ocrConfidence: field === "idDocument" && req.body.idOcrConfidence ? parseFloat(req.body.idOcrConfidence) : undefined
        };

        user.set(`providerProfile.verificationDocs.${field}`, newDoc);

        console.log(`[VERIFICATION_TRACE] Set ${field} status to PENDING with URL: ${url}`);

        // Sync to legacy if applicable
        if (field === "idDocument") user.set('providerProfile.verificationDocs.idDocumentUrl', url);
        if (field === "driverLicense") user.set('providerProfile.verificationDocs.licenseUrl', url);
        if (field === "proofOfVehicle") user.set('providerProfile.verificationDocs.vehicleProofUrl', url);

        user.markModified('providerProfile.verificationDocs');
        user.markModified(`providerProfile.verificationDocs.${field}`);
        console.log(`[VERIFICATION_TRACE] markedModified for verificationDocs and ${field}`);
      };

      const docFields = [
        "idDocument",
        "driverLicense",
        "selfie",
        "vehicleRC1",
        "huruCriminalCheck",
        "proofOfResidence",
        "proofOfVehicle",
        "vehicleLicenseDisc",
      ];

      for (const field of docFields) {
        await uploadDoc(field);
      }

      // Handle legacy keys if they were sent instead
      if (files.idDocumentUrl?.[0] && !files.idDocument?.[0]) await uploadDoc("idDocumentUrl");
      if (files.licenseUrl?.[0] && !files.driverLicense?.[0]) await uploadDoc("driverLicense");
      if (files.vehicleProofUrl?.[0] && !files.proofOfVehicle?.[0]) await uploadDoc("proofOfVehicle");

      // ✅ set overall verification status to PENDING if it was NOT_SUBMITTED or REJECTED
      if (user.providerProfile.verificationStatus !== "APPROVED") {
        user.providerProfile.verificationStatus = "PENDING";
      }

      await user.save();
      console.log(`[VERIFICATION_TRACE] user.save() completed for ${userId}`);

      return res.status(200).json({
        message: "Documents uploaded successfully ✅",
        verificationStatus: user.providerProfile.verificationStatus,
        verificationDocs: user.providerProfile.verificationDocs,
        user: await User.findById(user._id).select("name email phone role providerProfile createdAt updatedAt")
      });
    } catch (err) {
      console.error(`[VERIFICATION_TRACE] ERROR: ${err.message}`, err);
      return res.status(500).json({
        message: "Failed to upload documents ❌",
        error: err.message,
      });
    }
  }
);

export default router;