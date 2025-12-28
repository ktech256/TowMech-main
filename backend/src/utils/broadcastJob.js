import Job, { JOB_STATUSES } from '../models/Job.js';
import User, { USER_ROLES } from '../models/User.js';
import { sendPushToManyUsers } from './sendPush.js';

/**
 * ✅ Broadcast job to nearest 10 matching providers
 * ✅ ALSO sends push notifications (Bolt style)
 *
 * ✅ Called from:
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

  // ✅ Debug: show provider IDs
  console.log(
    '✅ Provider IDs found:',
    providers.map((p) => p._id.toString())
  );

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
   * ✅ SEND PUSH NOTIFICATIONS (FULL DEBUG)
   */
  try {
    // ✅ Build token list (prefer providerProfile.fcmToken, fallback to root fcmToken)
    const providersWithTokens = providers
      .map((p) => ({
        id: p._id.toString(),
        token: p.providerProfile?.fcmToken || p.fcmToken || null
      }))
      .filter((p) => p.token);

    console.log('✅ Providers with tokens:', providersWithTokens.length);

    console.log(
      '✅ Token preview:',
      providersWithTokens.map((p) => ({
        id: p.id,
        token: p.token.slice(0, 15) + '...'
      }))
    );

    // ✅ Debug missing tokens
    const missingTokens = providers
      .filter((p) => !(p.providerProfile?.fcmToken || p.fcmToken))
      .map((p) => p._id.toString());

    if (missingTokens.length > 0) {
      console.log('⚠️ Providers missing tokens:', missingTokens);
    }

    if (providersWithTokens.length > 0) {
      const pushTitle = '🚨 New Job Request Near You';

      const towType = job.towTruckTypeNeeded ? `Tow Type: ${job.towTruckTypeNeeded}` : '';
      const vehicle = job.vehicleType ? `Vehicle: ${job.vehicleType}` : '';
      const pickup = job.pickupAddressText ? `Pickup: ${job.pickupAddressText}` : '';

      const pushBody = `${job.title}\n${[towType, vehicle, pickup].filter(Boolean).join(' | ')}`;

      // ✅ Send push
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

      // ✅ If failures, log detailed error codes
      if (response?.failureCount > 0) {
        console.log(
          '⚠️ Push failure responses:',
          response.responses.map((r, i) => ({
            index: i,
            success: r.success,
            error: r.error?.message || null,
            code: r.error?.code || null
          }))
        );
      }

      console.log('✅ Push notifications attempted ✅');
    } else {
      console.log('⚠️ No providers had tokens → push not sent.');
    }
  } catch (err) {
    console.error('⚠️ Push notification failed FULL ERROR:', err);
  }

  return { message: 'Job broadcasted successfully', providers };
};