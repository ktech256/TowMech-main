import User, { USER_ROLES } from "../models/User.js";

/**
 * ✅ Find nearby matching providers within range
 * ✅ FIXED:
 * - towTruckTypeNeeded default = undefined
 * - ignores null/"null"/""/"undefined"
 * - trims towTruckTypeNeeded
 * - validates pickup coordinates
 */
export const findNearbyProviders = async ({
  roleNeeded,
  pickupLng,
  pickupLat,
  towTruckTypeNeeded = undefined,
  vehicleType = null,
  excludedProviders = [],
  maxDistanceMeters = 20000,
  limit = 10,
}) => {
  // ✅ Safety check: must have coordinates
  if (pickupLat === undefined || pickupLng === undefined) {
    console.log("❌ findNearbyProviders: Missing pickup coordinates");
    return [];
  }

  const providerQuery = {
    role: roleNeeded,
    "providerProfile.isOnline": true,
    "providerProfile.verificationStatus": "APPROVED",
    _id: { $nin: excludedProviders || [] },
  };

  /**
   * ✅ TowTruck extra filters
   */
  if (roleNeeded === USER_ROLES.TOW_TRUCK) {
    // ✅ normalize towTruckTypeNeeded input
    const normalizedTowTruckType =
      typeof towTruckTypeNeeded === "string"
        ? towTruckTypeNeeded.trim()
        : towTruckTypeNeeded;

    // ✅ Only apply filter if valid string is provided
    if (
      normalizedTowTruckType &&
      normalizedTowTruckType !== "null" &&
      normalizedTowTruckType !== "undefined"
    ) {
      providerQuery["providerProfile.towTruckTypes"] = normalizedTowTruckType;
    }

    // ✅ Optional filter for supported vehicle types
    if (vehicleType) {
      providerQuery["providerProfile.carTypesSupported"] = vehicleType;
    }
  }

  // ✅ DEBUG LOG
  console.log("✅ findNearbyProviders QUERY:", providerQuery);

  const providers = await User.find(providerQuery)
    .where("providerProfile.location")
    .near({
      center: { type: "Point", coordinates: [pickupLng, pickupLat] },
      maxDistance: maxDistanceMeters,
      spherical: true,
    })
    .limit(limit);

  return providers;
};