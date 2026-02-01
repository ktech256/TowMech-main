// backend/src/routes/adminCountryServices.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";

const router = express.Router();

/**
 * GET /api/admin/country-services/:countryCode
 */
router.get(
  "/:countryCode",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const countryCode = String(req.params.countryCode || "ZA").trim().toUpperCase();

      let config = await CountryServiceConfig.findOne({ countryCode });
      if (!config) {
        config = await CountryServiceConfig.create({ countryCode, services: {}, payments: {} });
      }

      return res.status(200).json({ config });
    } catch (err) {
      return res.status(500).json({ message: "Failed to load config", error: err.message });
    }
  }
);

/**
 * PUT /api/admin/country-services
 * body: { countryCode, services }
 */
router.put(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { countryCode, services } = req.body || {};
      const cc = String(countryCode || "ZA").trim().toUpperCase();

      if (!services || typeof services !== "object") {
        return res.status(400).json({ message: "services object is required" });
      }

      const config = await CountryServiceConfig.findOneAndUpdate(
        { countryCode: cc },
        { $set: { services } },
        { new: true, upsert: true }
      );

      return res.status(200).json({ message: "Saved ✅", config });
    } catch (err) {
      return res.status(500).json({ message: "Save failed", error: err.message });
    }
  }
);

export default router;