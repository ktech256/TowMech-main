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
 */
export const calculateJobPricing = async ({
  roleNeeded,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  towTruckTypeNeeded,
  vehicleType,
  distanceKm
}) => {
  let pricingConfig = await PricingConfig.findOne();
  if (!pricingConfig) pricingConfig = await PricingConfig.create({});

  const currency = pricingConfig.currency || "ZAR";

  // ✅ Determine provider pricing based on role
  const providerPricing =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? pricingConfig.providerBasePricing?.towTruck
      : pricingConfig.providerBasePricing?.mechanic;

  // ✅ fallback to legacy pricing if provider pricing missing
  const baseFee = providerPricing?.baseFee ?? pricingConfig.baseFee ?? 0;
  const perKmFee = providerPricing?.perKmFee ?? pricingConfig.perKmFee ?? 0;

  const nightFee = providerPricing?.nightFee ?? 0;
  const weekendFee = providerPricing?.weekendFee ?? 0;

  // ✅ Use provided distanceKm if exists, else compute fallback
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

  // ✅ Multipliers
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

  // ✅ Night / Weekend bonuses
  const applyNightFee = isNightTime() ? nightFee : 0;
  const applyWeekendFee = isWeekend() ? weekendFee : 0;

  // ✅ Estimated total fare
  const estimatedTotal =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? (baseFee + perKmFee * estimatedDistanceKm + applyNightFee + applyWeekendFee) *
        towMult *
        vehicleMult *
        surgeMultiplier
      : baseFee + applyNightFee + applyWeekendFee; // mechanic can still have base fee + bonuses

  // ✅ Booking fees
  const towBookingPercent = pricingConfig.bookingFees?.towTruckPercent || 15;
  const mechanicFixedFee = pricingConfig.bookingFees?.mechanicFixed || 200;

  const bookingFee =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? Math.round((estimatedTotal * towBookingPercent) / 100)
      : Math.round(mechanicFixedFee * (pricingConfig.surgePricing?.mechanicBookingFeeMultiplier || 1));

  // ✅ Commission + provider share (TowTruck only)
  const towTruckCompanyPercent =
    pricingConfig.payoutSplit?.towTruckCompanyPercent || 15;

  const commissionAmount =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? Math.round((estimatedTotal * towTruckCompanyPercent) / 100)
      : 0;

  const providerAmountDue =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? Math.max(estimatedTotal - commissionAmount, 0)
      : 0;

  return {
    currency,
    baseFee,
    perKmFee,
    nightFeeApplied: applyNightFee,
    weekendFeeApplied: applyWeekendFee,
    estimatedDistanceKm,
    towTruckTypeMultiplier: towMult,
    vehicleTypeMultiplier: vehicleMult,
    surgeMultiplier,
    estimatedTotal: Math.round(estimatedTotal),
    bookingFee,
    commissionAmount,
    providerAmountDue
  };
};
