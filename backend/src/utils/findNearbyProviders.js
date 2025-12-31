import User, { USER_ROLES } from '../models/User.js';

/**
 * ✅ Find nearby matching providers within range
 */
export const findNearbyProviders = async ({
  roleNeeded,
  pickupLng,
  pickupLat,
  towTruckTypeNeeded = null,
  vehicleType = null,
  excludedProviders = [],
  maxDistanceMeters = 20000,
  limit = 10
}) => {
  const providerQuery = {
    role: roleNeeded,
    'providerProfile.isOnline': true,
    'providerProfile.verificationStatus': 'APPROVED',
    _id: { $nin: excludedProviders || [] }
  };

  // ✅ TowTruck extra filters
  if (roleNeeded === USER_ROLES.TOW_TRUCK) {
    if (towTruckTypeNeeded) {
      providerQuery['providerProfile.towTruckTypes'] = towTruckTypeNeeded;
    }
    if (vehicleType) {
      providerQuery['providerProfile.carTypesSupported'] = vehicleType;
    }
  }

  const providers = await User.find(providerQuery)
    .where('providerProfile.location')
    .near({
      center: { type: 'Point', coordinates: [pickupLng, pickupLat] },
      maxDistance: maxDistanceMeters,
      spherical: true
    })
    .limit(limit);

  return providers;
};