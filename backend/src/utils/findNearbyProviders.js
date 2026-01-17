// utils/findNearbyProviders.js
import User, { USER_ROLES } from "../models/User.js";
import Job, { JOB_STATUSES } from "../models/Job.js";

/**
 * ✅ Haversine Distance (km)
 */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;

  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/**
 * ✅ Find nearby matching providers within range
 *
 * ✅ Keeps your existing behavior:
 * - 20km geo radius
 * - towTruckTypes filter
 * - vehicleType filter that does NOT exclude providers with empty carTypesSupported
 *
 * ✅ Adds Mechanic category filtering:
 * - mechanicCategoryNeeded -> providerProfile.mechanicCategories
 *
 * ✅ Broadcast rules retained with a fix:
 * - The "IN_PROGRESS + >3km from dropoff" rule ONLY applies to TowTruck,
 *   because mechanic jobs typically have no dropoffLocation.
 */
export const findNearbyProviders = async ({
  roleNeeded,
  pickupLng,
  pickupLat,

  towTruckTypeNeeded = undefined,
  mechanicCategoryNeeded = undefined, // ✅ NEW

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
   * ✅ TowTruck filters
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
     * ✅ VehicleType filter should not exclude providers who didn't configure carTypesSupported.
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

  /**
   * ✅ Mechanic filters (NEW)
   */
  if (roleNeeded === USER_ROLES.MECHANIC) {
    const normalizedCategory =
      typeof mechanicCategoryNeeded === "string"
        ? mechanicCategoryNeeded.trim()
        : mechanicCategoryNeeded;

    if (
      normalizedCategory &&
      normalizedCategory !== "null" &&
      normalizedCategory !== "undefined"
    ) {
      providerQuery["providerProfile.mechanicCategories"] = normalizedCategory;
    }
  }

  console.log("✅ findNearbyProviders QUERY:", providerQuery);

  // ✅ Fetch more than limit, then filter out “busy” providers safely
  const preProviders = await User.find(providerQuery)
    .where("providerProfile.location")
    .near({
      center: { type: "Point", coordinates: [pickupLng, pickupLat] },
      maxDistance: maxDistanceMeters,
      spherical: true,
    })
    .limit(Math.max(limit * 3, 30));

  console.log("✅ Providers found (pre-filter):", preProviders.length);

  if (!preProviders.length) return [];

  // ✅ Pull active jobs for these providers in one query
  const providerIds = preProviders.map((p) => p._id);

  const activeStatuses = [JOB_STATUSES.ASSIGNED, JOB_STATUSES.IN_PROGRESS];

  const activeJobs = await Job.find({
    assignedTo: { $in: providerIds },
    status: { $in: activeStatuses },
  }).select("assignedTo status dropoffLocation");

  // Group active jobs by providerId
  const jobsByProvider = new Map(); // providerId -> { assignedCount, inProgressCount, inProgressJob }
  for (const j of activeJobs) {
    const pid = j.assignedTo?.toString();
    if (!pid) continue;

    if (!jobsByProvider.has(pid)) {
      jobsByProvider.set(pid, {
        assignedCount: 0,
        inProgressCount: 0,
        inProgressJob: null,
      });
    }

    const bucket = jobsByProvider.get(pid);

    if (j.status === JOB_STATUSES.ASSIGNED) bucket.assignedCount += 1;

    if (j.status === JOB_STATUSES.IN_PROGRESS) {
      bucket.inProgressCount += 1;
      if (!bucket.inProgressJob) bucket.inProgressJob = j;
    }
  }

  const eligible = [];

  for (const provider of preProviders) {
    const pid = provider._id.toString();
    const info = jobsByProvider.get(pid) || {
      assignedCount: 0,
      inProgressCount: 0,
      inProgressJob: null,
    };

    const totalActive = info.assignedCount + info.inProgressCount;

    // 1) Already has 2 active jobs => exclude
    if (totalActive >= 2) continue;

    // 2) Has 1 ASSIGNED job (and not in-progress) => exclude (already stacked next job)
    if (info.assignedCount >= 1 && info.inProgressCount === 0) continue;

    /**
     * 3) If IN_PROGRESS:
     * - TowTruck: allow only if within 3km of dropoff
     * - Mechanic: exclude (mechanic jobs usually don’t have dropoff; don’t stack)
     */
    if (info.inProgressCount >= 1) {
      if (roleNeeded === USER_ROLES.MECHANIC) {
        // ✅ mechanic should not receive new jobs while already in progress
        continue;
      }

      const job = info.inProgressJob;

      const dropCoords = job?.dropoffLocation?.coordinates;
      if (!Array.isArray(dropCoords) || dropCoords.length < 2) {
        // TowTruck with missing dropoff => exclude (cannot determine closeness)
        continue;
      }

      const dropLng = Number(dropCoords[0]);
      const dropLat = Number(dropCoords[1]);

      const myCoords = provider?.providerProfile?.location?.coordinates;
      if (!Array.isArray(myCoords) || myCoords.length < 2) continue;

      const myLng = Number(myCoords[0]);
      const myLat = Number(myCoords[1]);

      if (!Number.isFinite(myLat) || !Number.isFinite(myLng) || (myLat === 0 && myLng === 0)) {
        continue;
      }

      const distKm = haversineDistanceKm(myLat, myLng, dropLat, dropLng);

      if (distKm > 3) continue;

      eligible.push(provider);
      continue;
    }

    eligible.push(provider);
  }

  console.log("✅ Providers found (eligible):", eligible.length);

  return eligible.slice(0, limit);
};