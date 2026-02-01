// backend/src/routes/adminLegal.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import LegalDocument from "../models/LegalDocument.js";

const router = express.Router();

const normalizeType = (t) => String(t || "").trim().toUpperCase();
const normalizeLang = (l) => String(l || "en").trim().toLowerCase();
const normalizeCC = (c) => String(c || "ZA").trim().toUpperCase();

/**
 * GET /api/admin/legal?countryCode=ZA&type=TERMS&language=en
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const countryCode = normalizeCC(req.query.countryCode);
      const type = normalizeType(req.query.type);
      const languageCode = normalizeLang(req.query.language);

      const docs = await LegalDocument.find({
        countryCode,
        type,
        languageCode,
      }).sort({ isActive: -1, publishedAt: -1, updatedAt: -1 });

      return res.status(200).json({ documents: docs });
    } catch (err) {
      return res.status(500).json({ message: "Failed to load legal docs", error: err.message });
    }
  }
);

/**
 * POST /api/admin/legal
 */
router.post(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { countryCode, type, languageCode = "en", title, content, version = "1.0", isActive = false } =
        req.body || {};

      const doc = await LegalDocument.create({
        countryCode: normalizeCC(countryCode),
        type: normalizeType(type),
        languageCode: normalizeLang(languageCode),
        title: String(title || "").trim(),
        content: String(content || ""),
        version: String(version || "1.0").trim(),
        isActive: !!isActive,
        publishedAt: isActive ? new Date() : null,
        updatedBy: req.user?._id || null,
      });

      return res.status(201).json({ document: doc });
    } catch (err) {
      return res.status(500).json({ message: "Create failed", error: err.message });
    }
  }
);

/**
 * PUT /api/admin/legal/:id
 */
router.put(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const updated = await LegalDocument.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updatedBy: req.user?._id || null },
        { new: true }
      );

      if (!updated) return res.status(404).json({ message: "Document not found" });

      return res.status(200).json({ document: updated });
    } catch (err) {
      return res.status(500).json({ message: "Update failed", error: err.message });
    }
  }
);

/**
 * POST /api/admin/legal/publish
 * body: { id }
 * Make selected doc active, and deactivate others of same type/country/language.
 */
router.post(
  "/publish",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { id } = req.body || {};
      const doc = await LegalDocument.findById(id);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      await LegalDocument.updateMany(
        {
          _id: { $ne: doc._id },
          countryCode: doc.countryCode,
          languageCode: doc.languageCode,
          type: doc.type,
        },
        { $set: { isActive: false } }
      );

      doc.isActive = true;
      doc.publishedAt = new Date();
      doc.updatedBy = req.user?._id || null;
      await doc.save();

      return res.status(200).json({ document: doc });
    } catch (err) {
      return res.status(500).json({ message: "Publish failed", error: err.message });
    }
  }
);

export default router;