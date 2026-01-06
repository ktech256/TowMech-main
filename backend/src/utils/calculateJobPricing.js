// backend/src/utils/calculateJobPricing.js

import PricingConfig from "../models/PricingConfig.js";
import { USER_ROLES } from "../models/User.js";

/**
 * ✅ Calculate distance using Haversine Formula (KM)
 */
const haversineDistanceKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (value) => (value * Math.PI) / 180;

  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c * 10) / 10; // ✅ 1 decimal
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
  vehicleType
}) => {
  // ✅ Load config
  let pricingConfig = await PricingConfig.findOne();
  if (!pricingConfig) pricingConfig = await PricingConfig.create({});

  const baseFee = pricingConfig.baseFee || 0;
  const perKmFee = pricingConfig.perKmFee || 0;
  const currency = pricingConfig.currency || "ZAR";

  // ✅ Determine distance (TowTruck only)
  let estimatedDistanceKm = 0;
  if (
    roleNeeded === USER_ROLES.TOW_TRUCK &&
    dropoffLat !== undefined &&
    dropoffLng !== undefined
  ) {
    estimatedDistanceKm = haversineDistanceKm(
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng
    );
  }

  // ✅ Multipliers
  const towMult = towTruckTypeNeeded
    ? pricingConfig.towTruckTypeMultipliers?.[towTruckTypeNeeded] || 1
    : 1;

  const vehicleMult = vehicleType
    ? pricingConfig.vehicleTypeMultipliers?.[vehicleType] || 1
    : 1;

  // ✅ Surge
  const surgeEnabled = pricingConfig.surge?.enabled || false;
  const surgeMultiplier = surgeEnabled ? pricingConfig.surge?.multiplier || 1 : 1;

  // ✅ Base total (TowTruck only)
  const estimatedTotal =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? (baseFee + perKmFee * estimatedDistanceKm) *
        towMult *
        vehicleMult *
        surgeMultiplier
      : 0;

  // ✅ Booking fees
  const towBookingPercent = pricingConfig.bookingFees?.towTruckPercent || 15;
  const mechanicFixedFee = pricingConfig.bookingFees?.mechanicFixed || 200;

  const bookingFee =
    roleNeeded === USER_ROLES.TOW_TRUCK
      ? Math.round((estimatedTotal * towBookingPercent) / 100)
      : mechanicFixedFee;

  // ✅ Commission + provider share
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