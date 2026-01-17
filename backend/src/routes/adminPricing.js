import express from "express";
import PricingConfig from "../models/PricingConfig.js";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * Always use the most recently updated config.
 * This prevents "multiple PricingConfig docs" from causing stale values (like mechanicFixed=200).
 */
async function getLatestPricingConfig() {
  let config = await PricingConfig.findOne().sort({ updatedAt: -1, createdAt: -1 });
  if (!config) config = await PricingConfig.create({});
  return config;
}

/**
 * Pick only allowed fields from a body payload
 */
function buildUpdateDoc(body) {
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
    "mechanicCategoryPricing",
    "mechanicCategories",
    "towTruckTypes",
  ];

  const updateDoc = {};
  for (const key of allowedUpdates) {
    if (body[key] !== undefined) updateDoc[key] = body[key];
  }
  return updateDoc;
}

/**
 * ✅ GET pricing config
 * GET /api/pricing-config
 * Public route (used by app)
 */
router.get("/", async (req, res) => {
  try {
    const config = await getLatestPricingConfig();
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
      /**
       * Some dashboards send { pricing: {...} }.
       * Support both shapes safely.
       */
      const body =
        req.body && typeof req.body === "object"
          ? {
              ...req.body,
              ...(req.body.pricing && typeof req.body.pricing === "object" ? req.body.pricing : {}),
            }
          : {};

      const updateDoc = buildUpdateDoc(body);

      // Always update the latest config
      const config = await getLatestPricingConfig();

      // Apply updates using mongoose .set so nested objects work properly
      Object.entries(updateDoc).forEach(([key, val]) => {
        config.set(key, val);
        if (key === "mechanicCategoryPricing") config.markModified("mechanicCategoryPricing");
      });

      await config.save();

      /**
       * ✅ IMPORTANT: if multiple PricingConfig docs exist,
       * sync the same update into ALL of them so whichever one the app reads is consistent.
       */
      await PricingConfig.updateMany(
        { _id: { $ne: config._id } },
        { $set: updateDoc }
      );

      return res.status(200).json({
        message: "Pricing config updated ✅",
        config,
        syncedOtherConfigs: true,
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