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
 * Upload using form-data with keys:
 * - idDocumentUrl
 * - licenseUrl
 * - vehicleProofUrl
 * - workshopProofUrl
 */
router.patch(
  "/me/documents",
  auth,
  upload.fields([
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
      if (!user.providerProfile.verificationDocs)
        user.providerProfile.verificationDocs = {};

      const files = req.files;

      const uploadDoc = async (field) => {
        const file = files?.[field]?.[0];
        if (!file) return null;

        const fileName = `providers/${user._id}/${field}-${Date.now()}`;
        const url = await uploadToFirebase(
          file.buffer,
          fileName,
          file.mimetype
        );

        user.providerProfile.verificationDocs[field] = url;
        return url;
      };

      // ✅ Upload each doc if provided
      await uploadDoc("idDocumentUrl");
      await uploadDoc("licenseUrl");
      await uploadDoc("vehicleProofUrl");
      await uploadDoc("workshopProofUrl");

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
