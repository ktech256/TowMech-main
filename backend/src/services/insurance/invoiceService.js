// backend/src/services/insurance/invoiceService.js
import InsurancePartner from "../../models/InsurancePartner.js";
import Job from "../../models/Job.js";

/**
 * Helpers
 */
function toIso(d) {
  try {
    return d ? new Date(d).toISOString() : null;
  } catch {
    return null;
  }
}

function parseDateParam(d) {
  if (!d) return null;
  const dt = new Date(String(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function parseMonthToRange(month) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

/**
 * Validates query and returns UTC [start, end) range.
 * - month=YYYY-MM OR from/to=YYYY-MM-DD (inclusive to)
 */
export function parseInvoiceQueryToRange({ month, from, to }) {
  const m = String(month || "").trim();

  if (m) {
    if (!/^\d{4}-\d{2}$/.test(m)) {
      return { ok: false, message: "month must be in YYYY-MM format" };
    }
    const r = parseMonthToRange(m);
    return { ok: true, month: m, start: r.start, end: r.end };
  }

  const f = parseDateParam(from);
  const t = parseDateParam(to);

  if (!f || !t) {
    return { ok: false, message: "Provide month=YYYY-MM OR from & to dates" };
  }

  const start = new Date(f);
  start.setUTCHours(0, 0, 0, 0);

  // inclusive-to -> exclusive end (next day 00:00)
  const end = new Date(t);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);

  return { ok: true, month: null, start, end };
}

/**
 * Builds the EXACT invoice JSON your dashboard expects (invoice object only).
 */
export async function buildInsuranceInvoice({
  partnerId,
  countryCode,
  rangeStart,
  rangeEnd,
  month = null,
  providerId = null,
}) {
  const partner = await InsurancePartner.findById(partnerId).select(
    "name partnerCode email phone billingEmail contactEmail contactPhone contact"
  );

  if (!partner) {
    const err = new Error("Partner not found");
    err.statusCode = 404;
    throw err;
  }

  const filter = {
    countryCode,
    "insurance.enabled": true,
    "insurance.partnerId": partnerId,
    createdAt: { $gte: rangeStart, $lt: rangeEnd },
  };

  if (providerId) filter.assignedTo = providerId;

  const jobs = await Job.find(filter)
    .select(
      "status createdAt roleNeeded pickupAddressText dropoffAddressText pricing insurance customer assignedTo"
    )
    .populate("assignedTo", "name email phone role")
    .populate("customer", "name email phone role")
    .sort({ createdAt: -1 })
    .lean();

  let totalJobs = 0;
  let totalEstimatedTotal = 0;
  let totalBookingFeeWaived = 0;
  let totalCommission = 0;
  let totalProviderAmountDue = 0;

  const items = jobs.map((j) => {
    totalJobs += 1;

    const estimatedTotal = Number(j?.pricing?.estimatedTotal || 0) || 0;
    const bookingFee = Number(j?.pricing?.bookingFee || 0) || 0;
    const commissionAmount = Number(j?.pricing?.commissionAmount || 0) || 0;
    const providerAmountDue = Number(j?.pricing?.providerAmountDue || 0) || 0;

    totalEstimatedTotal += estimatedTotal;
    totalBookingFeeWaived += bookingFee;
    totalCommission += commissionAmount;
    totalProviderAmountDue += providerAmountDue;

    const providerObj = j.assignedTo
      ? {
          providerId: String(j.assignedTo?._id || ""),
          name: j.assignedTo?.name || null,
          email: j.assignedTo?.email || null,
          phone: j.assignedTo?.phone || null,
        }
      : null;

    const customerObj = j.customer
      ? {
          customerId: String(j.customer?._id || ""),
          name: j.customer?.name || null,
          email: j.customer?.email || null,
          phone: j.customer?.phone || null,
        }
      : null;

    return {
      jobId: String(j?._id),
      shortId: String(j?._id).slice(-8).toUpperCase(),
      createdAt: toIso(j.createdAt),
      status: j.status,
      roleNeeded: j.roleNeeded,

      pickupAddressText: j.pickupAddressText || null,
      dropoffAddressText: j.dropoffAddressText || null,

      provider: providerObj,
      customer: customerObj,

      pricing: {
        currency: j?.pricing?.currency || "ZAR",
        estimatedTotal,
        bookingFee,
        commissionAmount,
        providerAmountDue,
        estimatedDistanceKm: Number(j?.pricing?.estimatedDistanceKm || 0) || 0,
      },

      insurance: {
        enabled: !!j?.insurance?.enabled,
        code: j?.insurance?.code || null,
        partnerId: String(j?.insurance?.partnerId || ""),
        validatedAt: toIso(j?.insurance?.validatedAt),
      },
    };
  });

  // groupedByProvider (who you owe)
  const byProvider = new Map();
  for (const it of items) {
    const pid = it?.provider?.providerId;
    if (!pid) continue;

    const cur = byProvider.get(pid) || {
      providerId: pid,
      name: it?.provider?.name || null,
      jobCount: 0,
      totalProviderAmountDue: 0,
      currency: it?.pricing?.currency || "ZAR",
    };

    cur.jobCount += 1;
    cur.totalProviderAmountDue += Number(it?.pricing?.providerAmountDue || 0) || 0;
    if (!cur.name && it?.provider?.name) cur.name = it.provider.name;

    byProvider.set(pid, cur);
  }

  const groupedByProvider = Array.from(byProvider.values()).sort(
    (a, b) => (b.totalProviderAmountDue || 0) - (a.totalProviderAmountDue || 0)
  );

  const partnerEmail =
    partner.email ||
    partner.billingEmail ||
    partner.contactEmail ||
    partner.contact?.email ||
    null;

  const partnerPhone =
    partner.phone ||
    partner.contactPhone ||
    partner.contact?.phone ||
    null;

  return {
    partner: {
      partnerId: String(partner._id),
      name: partner.name,
      partnerCode: partner.partnerCode,
      email: partnerEmail,
      phone: partnerPhone,
    },
    countryCode,
    currency: "ZAR",
    period: {
      month: month || null,
      from: toIso(rangeStart),
      to: toIso(rangeEnd),
    },
    filters: {
      providerId: providerId || null,
    },
    totals: {
      totalJobs,
      totalEstimatedTotal,
      totalBookingFeeWaived,
      totalCommission,
      totalProviderAmountDue,
    },
    items,
    groupedByProvider,
  };
}