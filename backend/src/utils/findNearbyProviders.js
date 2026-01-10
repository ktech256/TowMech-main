import User, { USER_ROLES } from "../models/User.js";

/**
 * ✅ Find nearby matching providers within range
 * ✅ FIXED:
 * - supports all vehicles if providerProfile.carTypesSupported is empty
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
   * ✅ TowTruck type filter
   */
  if (roleNeeded === USER_ROLES.TOW_TRUCK) {
    const normalizedTowTruckType =
      typeof towTruckTypeNeeded === "string"
        ? towTruckTypeNeeded.trim()
        : towTruckTypeNeeded;

    if (
      normalizedTowTruckType &&
      normalizedTowTruckType !== "null" &&
      normalizedTowTruckType !== "undefined"
    ) {
      providerQuery["providerProfile.towTruckTypes"] = normalizedTowTruckType;
    }

    /**
     * ✅ FIX: VehicleType filter should not exclude providers who didn't configure carTypesSupported.
     * ✅ If provider has empty carTypesSupported, treat it as "supports all"
     */
    if (vehicleType) {
      providerQuery["$or"] = [
        { "providerProfile.carTypesSupported": vehicleType },
        { "providerProfile.carTypesSupported": { $exists: false } },
        { "providerProfile.carTypesSupported": { $size: 0 } },
      ];
    }
  }

  console.log("✅ findNearbyProviders QUERY:", providerQuery);

  const providers = await User.find(providerQuery)
    .where("providerProfile.location")
    .near({
      center: { type: "Point", coordinates: [pickupLng, pickupLat] },
      maxDistance: maxDistanceMeters,
      spherical: true,
    })
    .limit(limit);

  console.log("✅ Providers found:", providers.length);

  return providers;
};