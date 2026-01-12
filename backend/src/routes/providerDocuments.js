import express from "express";
import multer from "multer";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import { uploadToFirebase } from "../utils/uploadToFirebase.js";

const router = express.Router();

// ✅ store file in memory
const upload = multer({ storage: multer.memoryStorage() });

/**
 * ✅ Provider uploads verification documents
 * PATCH /api/providers/me/documents
 *
 * Upload using form-data with keys (supports BOTH):
 * - idDocument OR idDocumentUrl
 * - license OR licenseUrl
 * - vehicleProof OR vehicleProofUrl
 * - workshopProof OR workshopProofUrl
 */
router.patch(
  "/me/documents",
  auth,
  upload.fields([
    { name: "idDocument", maxCount: 1 },
    { name: "license", maxCount: 1 },
    { name: "vehicleProof", maxCount: 1 },
    { name: "workshopProof", maxCount: 1 },

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

      // ✅ Ensure provider only
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

      // helper: find file by either new key or legacy key
      const getFile = (primaryKey, legacyKey) =>
        files?.[primaryKey]?.[0] || files?.[legacyKey]?.[0] || null;

      const uploadDoc = async (primaryKey, legacyKey, saveKey) => {
        const file = getFile(primaryKey, legacyKey);
        if (!file) return null;

        const fileName = `providers/${user._id}/${saveKey}-${Date.now()}`;
        const url = await uploadToFirebase(file.buffer, fileName, file.mimetype);

        user.providerProfile.verificationDocs[saveKey] = url;
        return url;
      };

      // ✅ Upload each doc if provided
      await uploadDoc("idDocument", "idDocumentUrl", "idDocumentUrl");
      await uploadDoc("license", "licenseUrl", "licenseUrl");
      await uploadDoc("vehicleProof", "vehicleProofUrl", "vehicleProofUrl");
      await uploadDoc("workshopProof", "workshopProofUrl", "workshopProofUrl");

      // ✅ set provider status to pending after upload
      user.providerProfile.verificationStatus = "PENDING";

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