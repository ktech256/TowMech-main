import express from "express";
import PricingConfig from "../models/PricingConfig.js";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ GET pricing config
 * GET /api/pricing-config
 * Public route (used by app)
 */
router.get("/", async (req, res) => {
  try {
    let config = await PricingConfig.findOne();

    // ✅ Auto-create if missing
    if (!config) config = await PricingConfig.create({});

    return res.status(200).json({ config });
  } catch (err) {
    return res.status(500).json({
      message: "Could not fetch pricing config",
      error: err.message,
    });
  }
});

/**
 * ✅ UPDATE pricing config
 * PATCH /api/pricing-config
 * ✅ Only SuperAdmin OR Admin with canManagePricing ✅
 */
router.patch(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManagePricing"),
  async (req, res) => {
    try {
      let config = await PricingConfig.findOne();
      if (!config) config = await PricingConfig.create({});

      /**
       * ✅ SAFE UPDATE (Whitelist fields)
       */
      const allowedUpdates = [
        "currency",
        "baseFee",
        "perKmFee",

        "providerBasePricing",

        "towTruckTypePricing",
        "towTruckTypeMultipliers",
        "vehicleTypeMultipliers",

        "bookingFees",
        "payoutSplit",
        "surgePricing",
        "refundRules",
        "payoutRules",

        // ✅ NEW: mechanic categories booking fee config
        "mechanicCategoryPricing",
      ];

      let touchedMechanicCategoryPricing = false;

      allowedUpdates.forEach((field) => {
        if (req.body[field] !== undefined) {
          config[field] = req.body[field];

          if (field === "mechanicCategoryPricing") {
            touchedMechanicCategoryPricing = true;
          }
        }
      });

      /**
       * ✅ IMPORTANT:
       * mechanicCategoryPricing is Mixed.
       * Ensure mongoose persists nested changes reliably.
       */
      if (touchedMechanicCategoryPricing) {
        config.markModified("mechanicCategoryPricing");
      }

      await config.save();

      return res.status(200).json({
        message: "Pricing config updated ✅",
        config,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not update pricing config",
        error: err.message,
      });
    }
  }
);

export default router;