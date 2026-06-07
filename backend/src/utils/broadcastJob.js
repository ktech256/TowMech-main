import Job, { JOB_STATUSES } from "../models/Job.js";
import { sendPushToManyUsers } from "./sendPush.js";
import { findNearbyProviders } from "./findNearbyProviders.js";
import { USER_ROLES } from "../models/User.js";

/**
 * ✅ Broadcast job to nearest 10 matching providers
 * ✅ Also sends push notifications (Bolt style)
 *
 * ✅ Called from:
 * - routes/payments.js (after booking fee payment)
 * - routes/jobs.js (when insuranceWaived sets booking fee as paid)
 */
export const broadcastJobToProviders = async (jobId) => {
  const job = await Job.findById(jobId);

  if (!job) throw new Error("Job not found");

  /**
   * ✅ BOOKING FEE CHECK
   * Only broadcast if booking fee is PAID
   */
  const bookingFeeStatus = job.pricing?.bookingFeeStatus
    ? String(job.pricing.bookingFeeStatus).toUpperCase()
    : null;

  const bookingFeePaid =
    bookingFeeStatus === "PAID" || job.pricing?.bookingFeePaidAt != null;

  if (!bookingFeePaid) {
    console.log("⛔ Booking fee NOT PAID. Job not broadcasted.");
    console.log("⛔ bookingFeeStatus:", job.pricing?.bookingFeeStatus);
    console.log("⛔ bookingFeePaidAt:", job.pricing?.bookingFeePaidAt);
    return { message: "Booking fee not paid", providers: [] };
  }

  console.log("✅ Booking fee PAID → broadcasting job");

  // ✅ Pickup coords from GeoJSON [lng, lat]
  const [pickupLng, pickupLat] = job.pickupLocation?.coordinates || [null, null];

  if (pickupLng == null || pickupLat == null) {
    console.log("❌ Job missing pickupLocation coordinates. Cannot broadcast.");
    return { message: "Job missing pickup coordinates", providers: [] };
  }

  /**
   * ✅ Mechanic category needed
   * Comes from Job model: mechanicCategoryNeeded
   */
  const mechanicCategoryNeeded =
    job.mechanicCategoryNeeded || job.mechanicCategory || null;

  /**
   * ✅ Find providers using shared helper
   * TowTruck -> towTruckTypeNeeded + vehicleType
   * Mechanic -> mechanicCategoryNeeded
   */
  const providers = await findNearbyProviders({
    roleNeeded: job.roleNeeded,
    pickupLng,
    pickupLat,

    // TowTruck filters
    towTruckTypeNeeded: job.towTruckTypeNeeded,
    vehicleType: job.vehicleType,

    // Mechanic filter
    mechanicCategoryNeeded,

    // ✅ NEW: Insurance filtering
    isInsurance: !!job.insurance?.enabled,

    excludedProviders: job.excludedProviders || [],
    maxDistanceMeters: 20000,
    limit: 10,
  });

  console.log("✅ Providers found:", providers.length);
  console.log(
    "✅ Provider IDs:",
    providers.map((p) => p._id.toString())
  );

  // ✅ Save broadcast list + status
  job.broadcastedTo = providers.map((p) => p._id);
  job.status = JOB_STATUSES.BROADCASTED;

  // ✅ Track dispatch attempts
  job.dispatchAttempts = providers.map((p) => ({
    providerId: p._id,
    attemptedAt: new Date(),
  }));

  await job.save();

  /**
   * ✅ Pricing display logic
   *
   * TowTruck:
   * - totalFee exists (estimatedTotal)
   * - providerPayout = totalFee - bookingFee
   *
   * Mechanic:
   * - final fee unknown
   * - totalFee should be 0
   * - providerPayout should be 0 (do not mislead)
   */
  const bookingFee = Number(job.pricing?.bookingFee || 0);

  // Try common total fields safely
  const totalCandidates = [
    job.pricing?.totalAmount,
    job.pricing?.totalFee,
    job.pricing?.total,
    job.pricing?.grandTotal,
    job.pricing?.estimatedTotal,
    job.pricing?.estimatedTotalFee,
    job.totalAmount,
  ].map((v) => (v == null ? null : Number(v)));

  const detectedTotalFee =
    totalCandidates.find((v) => typeof v === "number" && !Number.isNaN(v)) || 0;

  const currency = job.pricing?.currency || "ZAR";

  // ✅ Force mechanic total to 0 (as requested)
  const totalFee = job.roleNeeded === USER_ROLES.MECHANIC ? 0 : detectedTotalFee;

  // ✅ Provider payout:
  // TowTruck: total - bookingFee
  // Mechanic: 0 (final fee decided later)
  const providerPayout =
    job.roleNeeded === USER_ROLES.MECHANIC ? 0 : Math.max(0, totalFee - bookingFee);

  /**
   * ✅ SEND PUSH NOTIFICATIONS
   */
  try {
    const providersWithTokens = providers
      .map((p) => ({
        id: p._id.toString(),
        token: p.providerProfile?.fcmToken || p.fcmToken || null,
      }))
      .filter((p) => p.token);

    console.log("✅ Providers with tokens:", providersWithTokens.length);

    if (providersWithTokens.length > 0) {
      const isInsurance = !!job.insurance?.enabled;
      const jobTypeText = isInsurance ? "INSURANCE JOB" : "CASH JOB";

      const pushTitle =
        job.roleNeeded === USER_ROLES.MECHANIC
          ? `🔧 ${jobTypeText}: New Mechanic Job`
          : `🚨 ${jobTypeText}: New Job Request`;

      // TowTruck extras
      const towType = job.towTruckTypeNeeded ? `Tow Type: ${job.towTruckTypeNeeded}` : "";
      const vehicle = job.vehicleType ? `Vehicle: ${job.vehicleType}` : "";

      // Mechanic extras
      const mechCategory = mechanicCategoryNeeded ? `Category: ${mechanicCategoryNeeded}` : "";

      const pickupText = job.pickupAddressText ? `Pickup: ${job.pickupAddressText}` : "";

      const pushBody = `${job.title || "TowMech Service"}\n${[
        job.roleNeeded === USER_ROLES.MECHANIC ? mechCategory : towType,
        job.roleNeeded === USER_ROLES.MECHANIC ? "" : vehicle,
        pickupText,
      ]
        .filter(Boolean)
        .join(" | ")}`;

      const response = await sendPushToManyUsers({
        userIds: providersWithTokens.map((p) => p.id),
        title: pushTitle,
        body: pushBody,

        // ✅ DATA used by Android app routing + popup content
        data: {
          open: "job_requests",
          jobId: job._id.toString(),

          // Helpful for foreground handling
          title: pushTitle,
          body: pushBody,

          // Popup details
          pickup: String(job.pickupAddressText || ""),
          dropoff: String(job.dropoffAddressText || ""),

          roleNeeded: String(job.roleNeeded || ""),

          // TowTruck
          towTruckTypeNeeded: String(job.towTruckTypeNeeded || ""),
          vehicleType: String(job.vehicleType || ""),

          // Mechanic
          mechanicCategoryNeeded: String(mechanicCategoryNeeded || ""),

          // ✅ Customer problem description (correct field)
          customerProblemDescription: String(job.customerProblemDescription || ""),

          // Amount display
          currency: String(currency),
          bookingFee: String(bookingFee),

          // TowTruck only (Mechanic stays 0)
          totalFee: String(totalFee),
          providerPayout: String(providerPayout),

          // Distance: compute per provider on Android
          pickupLat: String(pickupLat),
          pickupLng: String(pickupLng),
        },
      });

      console.log("✅ Firebase multicast response:", response);
      console.log("✅ Push notifications attempted ✅");
    } else {
      console.log("⚠️ No providers had tokens → push not sent.");
    }
  } catch (err) {
    console.error("⚠️ Push notification failed FULL ERROR:", err);
  }

  return { message: "Job broadcasted successfully", providers };
};