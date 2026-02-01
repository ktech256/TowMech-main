// src/routes/legal.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import LegalDocument from "../models/LegalDocument.js";

const router = express.Router();

/**
 * Helper: resolve country + language from:
 * - req.countryCode (tenant middleware)
 * - header: x-country-code
 * - query: ?country=ZA
 */
function resolveCountryCode(req) {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query.country ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
}

/**
 * Helper: resolve language from:
 * - header: accept-language
 * - query: ?lang=en
 */
function resolveLanguageCode(req) {
  const q = (req.query.lang || req.query.language || "").toString().trim();
  if (q) return q.toLowerCase();

  const header = (req.headers["accept-language"] || "").toString().trim();
  if (!header) return "en";

  // take first language from "en-US,en;q=0.9"
  return header.split(",")[0].trim().slice(0, 2).toLowerCase() || "en";
}

/**
 * Normalize doc type
 */
function normalizeType(type) {
  const t = String(type || "")
    .trim()
    .toUpperCase();

  if (t === "TERMS" || t === "PRIVACY" || t === "REFUND" || t === "DISPUTE")
    return t;

  return null;
}

/**
 * =========================
 * PUBLIC ROUTES
 * =========================
 */

/**
 * Get active legal doc by type for a country + language
 * GET /api/legal/:type
 * Example:
 *  /api/legal/terms
 *  /api/legal/privacy?country=KE&lang=en
 */
router.get("/:type", async (req, res) => {
  try {
    const type = normalizeType(req.params.type);
    if (!type) {
      return res.status(400).json({
        message: "Invalid type. Use TERMS | PRIVACY | REFUND | DISPUTE",
      });
    }

    const countryCode = resolveCountryCode(req);
    const languageCode = resolveLanguageCode(req);

    // Try exact language match first
    let doc = await LegalDocument.findOne({
      countryCode,
      languageCode,
      type,
      isActive: true,
    }).sort({ publishedAt: -1, updatedAt: -1 });

    // Fallback to English if missing
    if (!doc && languageCode !== "en") {
      doc = await LegalDocument.findOne({
        countryCode,
        languageCode: "en",
        type,
        isActive: true,
      }).sort({ publishedAt: -1, updatedAt: -1 });
    }

    // Fallback to ZA English if country missing (global safety)
    if (!doc) {
      doc = await LegalDocument.findOne({
        countryCode: "ZA",
        languageCode: "en",
        type,
        isActive: true,
      }).sort({ publishedAt: -1, updatedAt: -1 });
    }

    if (!doc) {
      return res.status(404).json({
        message: "Legal document not found",
        type,
        countryCode,
        languageCode,
      });
    }

    return res.status(200).json({
      document: {
        id: doc._id,
        type: doc.type,
        countryCode: doc.countryCode,
        languageCode: doc.languageCode,
        version: doc.version,
        title: doc.title,
        content: doc.content,
        publishedAt: doc.publishedAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    console.error("❌ GET LEGAL DOC ERROR:", err);
    return res.status(500).json({
      message: "Could not fetch legal document",
      error: err.message,
    });
  }
});

/**
 * Get all active docs for a country (useful for mobile config)
 * GET /api/legal
 * Optional: ?country=ZA&lang=en
 */
router.get("/", async (req, res) => {
  try {
    const countryCode = resolveCountryCode(req);
    const languageCode = resolveLanguageCode(req);

    const docs = await LegalDocument.find({
      countryCode,
      languageCode,
      isActive: true,
    }).sort({ type: 1, publishedAt: -1, updatedAt: -1 });

    return res.status(200).json({
      countryCode,
      languageCode,
      documents: docs.map((d) => ({
        id: d._id,
        type: d.type,
        version: d.version,
        title: d.title,
        publishedAt: d.publishedAt,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (err) {
    console.error("❌ LIST LEGAL DOCS ERROR:", err);
    return res.status(500).json({
      message: "Could not fetch legal documents",
      error: err.message,
    });
  }
});

/**
 * =========================
 * ADMIN ROUTES
 * =========================
 * These allow SuperAdmin to manage legal docs.
 */

/**
 * Admin list (including inactive)
 * GET /api/legal/admin/list?country=ZA&lang=en&type=TERMS
 */
router.get(
  "/admin/list",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const countryCode = resolveCountryCode(req);
      const languageCode = resolveLanguageCode(req);

      const type = req.query.type ? normalizeType(req.query.type) : null;

      const query = {
        countryCode,
        languageCode,
      };

      if (type) query.type = type;

      const docs = await LegalDocument.find(query).sort({
        type: 1,
        isActive: -1,
        publishedAt: -1,
        updatedAt: -1,
      });

      return res.status(200).json({
        documents: docs.map((d) => ({
          id: d._id,
          type: d.type,
          countryCode: d.countryCode,
          languageCode: d.languageCode,
          version: d.version,
          title: d.title,
          isActive: d.isActive,
          publishedAt: d.publishedAt,
          updatedAt: d.updatedAt,
        })),
      });
    } catch (err) {
      console.error("❌ ADMIN LIST LEGAL DOCS ERROR:", err);
      return res.status(500).json({
        message: "Could not fetch admin legal documents",
        error: err.message,
      });
    }
  }
);

/**
 * Admin upsert/create a legal document
 * POST /api/legal/admin/upsert
 * body: { countryCode, languageCode, type, title, content, version, isActive, publishNow }
 */
router.post(
  "/admin/upsert",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const {
        countryCode,
        languageCode = "en",
        type,
        title,
        content,
        version = "1.0",
        isActive = true,
        publishNow = false,
      } = req.body || {};

      const t = normalizeType(type);
      if (!t) {
        return res.status(400).json({
          message: "Invalid type. Use TERMS | PRIVACY | REFUND | DISPUTE",
        });
      }

      if (!countryCode || !title || typeof content !== "string") {
        return res.status(400).json({
          message: "countryCode, title, content are required",
        });
      }

      const cc = String(countryCode).trim().toUpperCase();
      const lc = String(languageCode).trim().toLowerCase();

      // create new document (versioning can be improved later)
      const doc = await LegalDocument.create({
        countryCode: cc,
        languageCode: lc,
        type: t,
        title: String(title).trim(),
        content,
        version: String(version).trim(),
        isActive: !!isActive,
        publishedAt: publishNow ? new Date() : null,
        updatedBy: req.user?._id || null,
      });

      return res.status(201).json({
        message: "Legal document saved ✅",
        document: doc,
      });
    } catch (err) {
      console.error("❌ UPSERT LEGAL DOC ERROR:", err);
      return res.status(500).json({
        message: "Could not save legal document",
        error: err.message,
      });
    }
  }
);

/**
 * Admin activate/deactivate document
 * PATCH /api/legal/admin/:id/status
 * body: { isActive: true/false }
 */
router.patch(
  "/admin/:id/status",
  auth,
  authorizeRoles(USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { isActive } = req.body || {};

      const doc = await LegalDocument.findById(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      doc.isActive = !!isActive;
      doc.updatedBy = req.user?._id || null;

      await doc.save();

      return res.status(200).json({
        message: "Status updated ✅",
        document: doc,
      });
    } catch (err) {
      console.error("❌ UPDATE LEGAL DOC STATUS ERROR:", err);
      return res.status(500).json({
        message: "Could not update status",
        error: err.message,
      });
    }
  }
);

export default router;