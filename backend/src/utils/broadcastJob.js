import Job, { JOB_STATUSES } from '../models/Job.js';
import User, { USER_ROLES } from '../models/User.js';
import { sendPushToManyUsers } from './sendPush.js';

/**
 * ✅ Broadcast job to nearest 10 matching providers
 * ✅ ALSO sends push notifications (Bolt style)
 *
 * ✅ This helper can be called from:
 * - routes/jobs.js (job creation)
 * - routes/payments.js (after booking fee payment)
 */
export const broadcastJobToProviders = async (jobId) => {
  const job = await Job.findById(jobId);

  if (!job) throw new Error('Job not found');

  // ✅ Prevent broadcasting if booking fee not paid
  if (!job.pricing?.bookingFeePaid) {
    console.log('⛔ Booking fee not paid. Job not broadcasted.');
    return { message: 'Booking fee not paid', providers: [] };
  }

  const [lng, lat] = job.pickupLocation.coordinates;
  const role = job.roleNeeded;

  const providerQuery = {
    role,
    'providerProfile.isOnline': true,
    'providerProfile.verificationStatus': 'APPROVED',
    _id: { $nin: job.excludedProviders || [] }
  };

  // ✅ TowTruck additional filters
  if (role === USER_ROLES.TOW_TRUCK) {
    if (job.towTruckTypeNeeded) {
      providerQuery['providerProfile.towTruckTypes'] = job.towTruckTypeNeeded;
    }
    if (job.vehicleType) {
      providerQuery['providerProfile.carTypesSupported'] = job.vehicleType;
    }
  }

  const providers = await User.find(providerQuery)
    .where('providerProfile.location')
    .near({
      center: { type: 'Point', coordinates: [lng, lat] },
      maxDistance: 20000,
      spherical: true
    })
    .limit(10);

  console.log('✅ Providers found:', providers.length);

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
   * ✅ SEND PUSH NOTIFICATIONS (WITH FULL DEBUG)
   */
  try {
    const providersWithTokens = providers.filter((p) => p.providerProfile?.fcmToken);

    console.log('✅ Providers with tokens:', providersWithTokens.length);

    // ✅ Debug token preview
    console.log(
      '✅ Token preview:',
      providersWithTokens.map((p) => ({
        id: p._id.toString(),
        token: p.providerProfile.fcmToken.slice(0, 15) + '...'
      }))
    );

    if (providersWithTokens.length > 0) {
      const pushTitle = '🚨 New Job Request Near You';

      const towType = job.towTruckTypeNeeded ? `Tow Type: ${job.towTruckTypeNeeded}` : '';
      const vehicle = job.vehicleType ? `Vehicle: ${job.vehicleType}` : '';
      const pickup = job.pickupAddressText ? `Pickup: ${job.pickupAddressText}` : '';

      const pushBody =
        `${job.title}\n` +
        [towType, vehicle, pickup].filter(Boolean).join(' | ');

      // ✅ Send push
      const response = await sendPushToManyUsers({
        userIds: providersWithTokens.map((p) => p._id),
        title: pushTitle,
        body: pushBody,
        data: {
          jobId: job._id.toString(),
          roleNeeded: job.roleNeeded
        }
      });

      console.log('✅ Firebase multicast response:', response);

      // ✅ If any failures, log details
      if (response?.failureCount > 0) {
        console.log('⚠️ Push failures details:', response.responses);
      }

      console.log('✅ Push notifications sent!');
    }
  } catch (err) {
    // ✅ Log full error instead of only err.message
    console.error('⚠️ Push notification failed FULL ERROR:', err);
  }

  return { message: 'Job broadcasted successfully', providers };
};