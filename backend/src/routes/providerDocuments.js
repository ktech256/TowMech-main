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
      const user = await User.findById(userId);

      if (!user) return res.status(404).json({ message: "User not found" });

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

      const uploadDoc = async (field) => {
        const file = files[field]?.[0];
        if (!file) return;

        const fileName = `providers/${user._id}/${field}-${Date.now()}`;
        const url = await uploadToFirebase(file.buffer, fileName, file.mimetype);

        // Initialize object if it doesn't exist
        if (!user.providerProfile.verificationDocs[field]) {
          user.providerProfile.verificationDocs[field] = {};
        }

        user.providerProfile.verificationDocs[field] = {
          url,
          status: "PENDING",
          updatedAt: new Date(),
        };

        // Sync to legacy if applicable
        if (field === "idDocument") user.providerProfile.verificationDocs.idDocumentUrl = url;
        if (field === "driverLicense") user.providerProfile.verificationDocs.licenseUrl = url;
        if (field === "proofOfVehicle") user.providerProfile.verificationDocs.vehicleProofUrl = url;
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

      return res.status(200).json({
        message: "Documents uploaded successfully ✅",
        verificationStatus: user.providerProfile.verificationStatus,
        verificationDocs: user.providerProfile.verificationDocs,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to upload documents ❌",
        error: err.message,
      });
    }
  }
);

export default router;