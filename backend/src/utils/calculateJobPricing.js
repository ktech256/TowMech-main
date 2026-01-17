import PricingConfig from "../models/PricingConfig.js";
import { USER_ROLES } from "../models/User.js";

/**
 * ✅ Haversine distance fallback (KM)
 */
const haversineDistanceKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c * 10) / 10;
};

/**
 * ✅ Night / Weekend checker
 * Night: 20:00 - 06:00
 * Weekend: Saturday & Sunday
 */
const isNightTime = () => {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6;
};

const isWeekend = () => {
  const day = new Date().getDay();
  return day === 0 || day === 6; // Sunday or Saturday
};

/**
 * ✅ MAIN PRICING FUNCTION
 *
 * NEW (mechanic):
 * - accepts mechanicCategoryNeeded
 * - bookingFee is category-based (dashboard controlled)
 * - does NOT calculate estimatedTotal for mechanic
 */
export const calculateJobPricing = async ({
  roleNeeded,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  towTruckTypeNeeded,
  vehicleType,
  distanceKm,

  // ✅ NEW: accept both names to avoid breaking callers
  mechanicCategoryNeeded = null,
  mechanicCategory = null,
}) => {
  let pricingConfig = await PricingConfig.findOne();
  if (!pricingConfig) pricingConfig = await PricingConfig.create({});

  const currency = pricingConfig.currency || "ZAR";

  /**
   * ============================================================
   * ✅ TowTruck pricing (existing)
   * ============================================================
   */
  const providerPricing =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? pricingConfig.providerBasePricing?.towTruck
      : pricingConfig.providerBasePricing?.mechanic;

  const towTypePricing =
    roleNeeded === USER_ROLES.TOW_TRUCK && towTruckTypeNeeded
      ? pricingConfig.towTruckTypePricing?.[towTruckTypeNeeded] || null
      : null;

  const baseFee =
    towTypePricing?.baseFee ??
    providerPricing?.baseFee ??
    pricingConfig.baseFee ??
    0;

  const perKmFee =
    towTypePricing?.perKmFee ??
    providerPricing?.perKmFee ??
    pricingConfig.perKmFee ??
    0;

  const nightFee =
    towTypePricing?.nightFee ??
    providerPricing?.nightFee ??
    0;

  const weekendFee =
    towTypePricing?.weekendFee ??
    providerPricing?.weekendFee ??
    0;

  // ✅ distance calc (TowTruck only)
  let estimatedDistanceKm = 0;

  if (
    roleNeeded === USER_ROLES.TOW_TRUCK &&
    dropoffLat !== undefined &&
    dropoffLng !== undefined
  ) {
    if (distanceKm !== undefined && distanceKm !== null) {
      estimatedDistanceKm = Number(distanceKm);
    } else {
      estimatedDistanceKm = haversineDistanceKm(
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng
      );
    }
  }

  // ✅ Multipliers (TowTruck)
  const towMult =
    towTruckTypeNeeded
      ? pricingConfig.towTruckTypeMultipliers?.[towTruckTypeNeeded] || 1
      : 1;

  const vehicleMult =
    vehicleType
      ? pricingConfig.vehicleTypeMultipliers?.[vehicleType] || 1
      : 1;

  // ✅ Surge
  const surgeEnabled = pricingConfig.surgePricing?.enabled || false;
  const surgeMultiplier =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? pricingConfig.surgePricing?.towTruckMultiplier || 1
      : pricingConfig.surgePricing?.mechanicMultiplier || 1;

  const applyNightFee = isNightTime() ? nightFee : 0;
  const applyWeekendFee = isWeekend() ? weekendFee : 0;

  /**
   * ✅ TowTruck estimated total (existing)
   */
  const towTruckEstimatedTotal =
    (baseFee + perKmFee * estimatedDistanceKm + applyNightFee + applyWeekendFee) *
    towMult *
    vehicleMult *
    (surgeEnabled ? surgeMultiplier : 1);

  /**
   * ============================================================
   * ✅ Mechanic booking fee (FIXED)
   *
   * IMPORTANT:
   * - Your schema defaults category baseFee=0
   * - baseFee=0 should NOT override dashboard mechanicFixed
   *
   * Rule:
   * - If category baseFee is a positive number -> use it (+ night/weekend)
   * - Otherwise -> fallback to bookingFees.mechanicFixed
   * ============================================================
   */
  const chosenMechanicCategory =
    (typeof mechanicCategoryNeeded === "string" && mechanicCategoryNeeded.trim()) ||
    (typeof mechanicCategory === "string" && mechanicCategory.trim()) ||
    null;

  // Normalize key lookup (trim only; don’t change case to avoid breaking stored keys)
  const normalizedCat = chosenMechanicCategory ? chosenMechanicCategory.trim() : null;

  const mechanicCategoryPricing =
    normalizedCat && pricingConfig.mechanicCategoryPricing
      ? pricingConfig.mechanicCategoryPricing[normalizedCat] || null
      : null;

  const rawBase = mechanicCategoryPricing?.baseFee;
  const rawNight = mechanicCategoryPricing?.nightFee;
  const rawWeekend = mechanicCategoryPricing?.weekendFee;

  const mechanicBase = Number.isFinite(Number(rawBase)) ? Number(rawBase) : 0;
  const mechanicNight = Number.isFinite(Number(rawNight)) ? Number(rawNight) : 0;
  const mechanicWeekend = Number.isFinite(Number(rawWeekend)) ? Number(rawWeekend) : 0;

  const fallbackMechanicFixed = Number.isFinite(Number(pricingConfig.bookingFees?.mechanicFixed))
    ? Number(pricingConfig.bookingFees.mechanicFixed)
    : 200;

  const bookingMult = Number.isFinite(Number(pricingConfig.surgePricing?.mechanicBookingFeeMultiplier))
    ? Number(pricingConfig.surgePricing.mechanicBookingFeeMultiplier)
    : 1;

  const mechanicBookingFee =
    mechanicBase > 0
      ? Math.round(
          (mechanicBase +
            (isNightTime() ? mechanicNight : 0) +
            (isWeekend() ? mechanicWeekend : 0)) *
            bookingMult
        )
      : Math.round(fallbackMechanicFixed * bookingMult);

  /**
   * ✅ Booking fee for TowTruck (existing)
   */
  const towBookingPercent = pricingConfig.bookingFees?.towTruckPercent || 15;
  const towTruckBookingFee = Math.round((towTruckEstimatedTotal * towBookingPercent) / 100);

  // ✅ Commission + provider share (TowTruck only)
  const towTruckCompanyPercent = pricingConfig.payoutSplit?.towTruckCompanyPercent || 15;

  const commissionAmount =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? Math.round((towTruckEstimatedTotal * towTruckCompanyPercent) / 100)
      : 0;

  const providerAmountDue =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? Math.max(Math.round(towTruckEstimatedTotal) - commissionAmount, 0)
      : 0;

  /**
   * ✅ Final response
   * Mechanic: estimatedTotal forced to 0 (as requested)
   * TowTruck: full estimated total
   */
  const estimatedTotal =
    roleNeeded === USER_ROLES.TOW_TRUCK ? Math.round(towTruckEstimatedTotal) : 0;

  const bookingFee =
    roleNeeded === USER_ROLES.TOW_TRUCK ? towTruckBookingFee : mechanicBookingFee;

  return {
    currency,

    baseFee,
    perKmFee,

    nightFeeApplied: applyNightFee,
    weekendFeeApplied: applyWeekendFee,

    estimatedDistanceKm,

    towTruckTypeMultiplier: towMult,
    vehicleTypeMultiplier: vehicleMult,
    surgeMultiplier: surgeEnabled ? surgeMultiplier : 1,

    estimatedTotal,
    bookingFee,

    commissionAmount,
    providerAmountDue,

    // ✅ extra debug for mechanic category
    mechanicCategory: normalizedCat,
  };
};