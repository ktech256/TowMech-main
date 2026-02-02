// backend/src/routes/adminPricing.js
import express from "express";
import PricingConfig from "../models/PricingConfig.js";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ Resolve active workspace country (Tenant)
 */
const resolveCountryCode = (req) => {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query?.country ||
    req.query?.countryCode ||
    req.body?.countryCode ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * Always use the most recently updated config (PER COUNTRY).
 * Prevents multiple docs from causing stale values.
 */
async function getLatestPricingConfig(countryCode) {
  const code = String(countryCode || "ZA").toUpperCase();
  let config = await PricingConfig.findOne({ countryCode: code }).sort({
    updatedAt: -1,
    createdAt: -1,
  });
  if (!config) config = await PricingConfig.create({ countryCode: code });
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
 * ✅ GET pricing config (PER COUNTRY)
 * GET /api/pricing-config
 * Public route (used by app)
 */
router.get("/", async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const config = await getLatestPricingConfig(workspaceCountryCode);
    return res.status(200).json({ countryCode: workspaceCountryCode, config });
  } catch (err) {
    return res.status(500).json({
      message: "Could not fetch pricing config",
      error: err.message,
    });
  }
});

/**
 * ✅ UPDATE pricing config (PER COUNTRY)
 * PATCH /api/pricing-config
 * ✅ Only SuperAdmin OR Admin with canManagePricing ✅
 */
router.patch(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManagePricing"),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);

      /**
       * Some dashboards send { pricing: {...} }.
       * Support both shapes safely.
       */
      const body =
        req.body && typeof req.body === "object"
          ? {
              ...req.body,
              ...(req.body.pricing && typeof req.body.pricing === "object"
                ? req.body.pricing
                : {}),
            }
          : {};

      const updateDoc = buildUpdateDoc(body);

      const config = await getLatestPricingConfig(workspaceCountryCode);

      Object.entries(updateDoc).forEach(([key, val]) => {
        config.set(key, val);
        if (key === "mechanicCategoryPricing") config.markModified("mechanicCategoryPricing");
      });

      config.countryCode = workspaceCountryCode;
      await config.save();

      // ✅ Sync same update into ALL configs for this country (if duplicates exist)
      await PricingConfig.updateMany(
        { countryCode: workspaceCountryCode, _id: { $ne: config._id } },
        { $set: updateDoc }
      );

      return res.status(200).json({
        message: "Pricing config updated ✅",
        countryCode: workspaceCountryCode,
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