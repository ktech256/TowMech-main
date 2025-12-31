import Job, { JOB_STATUSES } from '../models/Job.js';
import { sendPushToManyUsers } from './sendPush.js';
import { findNearbyProviders } from './findNearbyProviders.js';

/**
 * ✅ Broadcast job to nearest 10 matching providers
 * ✅ Also sends push notifications (Bolt style)
 *
 * ✅ Called from:
 * - routes/payments.js (after booking fee payment)
 */
export const broadcastJobToProviders = async (jobId) => {
  const job = await Job.findById(jobId);

  if (!job) throw new Error('Job not found');

  /**
   * ✅ BOOKING FEE CHECK
   * Only broadcast if booking fee is PAID
   */
  const bookingFeePaid =
    job.pricing?.bookingFeeStatus === 'PAID' ||
    job.pricing?.bookingFeePaidAt !== null;

  if (!bookingFeePaid) {
    console.log('⛔ Booking fee NOT PAID. Job not broadcasted.');
    console.log('⛔ bookingFeeStatus:', job.pricing?.bookingFeeStatus);
    console.log('⛔ bookingFeePaidAt:', job.pricing?.bookingFeePaidAt);
    return { message: 'Booking fee not paid', providers: [] };
  }

  console.log('✅ Booking fee PAID → broadcasting job');

  const [pickupLng, pickupLat] = job.pickupLocation.coordinates;

  // ✅ Find providers using shared helper
  const providers = await findNearbyProviders({
    roleNeeded: job.roleNeeded,
    pickupLng,
    pickupLat,
    towTruckTypeNeeded: job.towTruckTypeNeeded,
    vehicleType: job.vehicleType,
    excludedProviders: job.excludedProviders || [],
    maxDistanceMeters: 20000,
    limit: 10
  });

  console.log('✅ Providers found:', providers.length);
  console.log('✅ Provider IDs:', providers.map((p) => p._id.toString()));

  // ✅ Save broadcast list + status
  job.broadcastedTo = providers.map((p) => p._id);
  job.status = JOB_STATUSES.BROADCASTED;

  // ✅ Track dispatch attempts
  job.dispatchAttempts = providers.map((p) => ({
    providerId: p._id,
    attemptedAt: new Date()
  }));

  await job.save();

  /**
   * ✅ SEND PUSH NOTIFICATIONS
   */
  try {
    const providersWithTokens = providers
      .map((p) => ({
        id: p._id.toString(),
        token: p.providerProfile?.fcmToken || p.fcmToken || null
      }))
      .filter((p) => p.token);

    console.log('✅ Providers with tokens:', providersWithTokens.length);

    if (providersWithTokens.length > 0) {
      const pushTitle = '🚨 New Job Request Near You';

      const towType = job.towTruckTypeNeeded ? `Tow Type: ${job.towTruckTypeNeeded}` : '';
      const vehicle = job.vehicleType ? `Vehicle: ${job.vehicleType}` : '';
      const pickup = job.pickupAddressText ? `Pickup: ${job.pickupAddressText}` : '';

      const pushBody = `${job.title}\n${[towType, vehicle, pickup].filter(Boolean).join(' | ')}`;

      const response = await sendPushToManyUsers({
        userIds: providersWithTokens.map((p) => p.id),
        title: pushTitle,
        body: pushBody,
        data: {
          jobId: job._id.toString(),
          roleNeeded: job.roleNeeded
        }
      });

      console.log('✅ Firebase multicast response:', response);
      console.log('✅ Push notifications attempted ✅');
    } else {
      console.log('⚠️ No providers had tokens → push not sent.');
    }
  } catch (err) {
    console.error('⚠️ Push notification failed FULL ERROR:', err);
  }

  return { message: 'Job broadcasted successfully', providers };
};