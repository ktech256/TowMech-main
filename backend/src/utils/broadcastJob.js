import Job, { JOB_STATUSES } from "../models/Job.js";
import { sendPushToManyUsers } from "./sendPush.js";
import { findNearbyProviders } from "./findNearbyProviders.js";

/**
 * ✅ Broadcast job to nearest 10 matching providers
 * ✅ Also sends push notifications (Bolt style)
 *
 * ✅ Called from:
 * - routes/payments.js (after booking fee payment)
 */
export const broadcastJobToProviders = async (jobId) => {
  const job = await Job.findById(jobId);

  if (!job) throw new Error("Job not found");

  /**
   * ✅ BOOKING FEE CHECK
   * Only broadcast if booking fee is PAID
   */
  const bookingFeePaid =
    job.pricing?.bookingFeeStatus === "PAID" || job.pricing?.bookingFeePaidAt != null;

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

  // ✅ Find providers using shared helper
  const providers = await findNearbyProviders({
    roleNeeded: job.roleNeeded,
    pickupLng,
    pickupLat,
    towTruckTypeNeeded: job.towTruckTypeNeeded,
    vehicleType: job.vehicleType,
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
   * ✅ Compute provider payout (total - bookingFee commission)
   * NOTE: adjust these fields if your pricing uses different names.
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

  const totalFee = totalCandidates.find((v) => typeof v === "number" && !Number.isNaN(v)) || 0;

  const providerPayout = Math.max(0, totalFee - bookingFee);
  const currency = job.pricing?.currency || "ZAR";

  /**
   * ✅ SEND PUSH NOTIFICATIONS
   *
   * IMPORTANT:
   * - You MUST include "open" + "jobId" in DATA
   * - For distance: multicast uses same data for all providers,
   *   so we send pickupLat/Lng and compute distance on Android per provider.
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
      const pushTitle = "🚨 New Job Request Near You";

      const towType = job.towTruckTypeNeeded ? `Tow Type: ${job.towTruckTypeNeeded}` : "";
      const vehicle = job.vehicleType ? `Vehicle: ${job.vehicleType}` : "";
      const pickupText = job.pickupAddressText ? `Pickup: ${job.pickupAddressText}` : "";

      const pushBody = `${job.title || "TowMech Service"}\n${[towType, vehicle, pickupText]
        .filter(Boolean)
        .join(" | ")}`;

      const response = await sendPushToManyUsers({
        userIds: providersWithTokens.map((p) => p.id),
        title: pushTitle,
        body: pushBody,

        // ✅ DATA is what your Android app uses to route + show popup content
        // ✅ Keep values simple; FCM requires strings (your sendPush.js normalizes, but we also stringify here)
        data: {
          open: "job_requests",
          jobId: job._id.toString(),

          // ✅ helpful for foreground handling
          title: pushTitle,
          body: pushBody,

          // ✅ Popup details
          pickup: String(job.pickupAddressText || ""),
          dropoff: String(job.dropoffAddressText || ""),
          roleNeeded: String(job.roleNeeded || ""),
          towTruckTypeNeeded: String(job.towTruckTypeNeeded || ""),
          vehicleType: String(job.vehicleType || ""),

          // ✅ Amount display (provider payout)
          currency: String(currency),
          bookingFee: String(bookingFee),
          totalFee: String(totalFee),
          providerPayout: String(providerPayout),

          // ✅ Distance: compute per provider on Android (since multicast is same for all)
          pickupLat: String(pickupLat),
          pickupLng: String(pickupLng),

          // Optional if you want
          // dropoffLat: String(job.dropoffLocation?.coordinates?.[1] ?? ""),
          // dropoffLng: String(job.dropoffLocation?.coordinates?.[0] ?? ""),
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