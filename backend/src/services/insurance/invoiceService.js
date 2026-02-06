// backend/src/services/insurance/invoiceService.js
import InsurancePartner from "../../models/InsurancePartner.js";
import Job from "../../models/Job.js";

function parseMonthToRange(month) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

function parseDateParam(d) {
  if (!d) return null;
  const dt = new Date(String(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function toIso(d) {
  try {
    return d ? new Date(d).toISOString() : null;
  } catch {
    return null;
  }
}

function normalizeMonth(month) {
  if (!month) return null;
  const m = String(month).trim();
  if (!m) return null;
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error("month must be in YYYY-MM format");
  return m;
}

function normalizeObjectIdLike(id) {
  const s = String(id || "").trim();
  return s ? s : null;
}

/**
 * Build invoice data once; used by:
 * - Partner claim invoice (gross total)
 * - Providers owed summary
 * - Provider detailed statement
 */
export async function buildInsuranceInvoice(args) {
  const countryCode = String(args.countryCode || "ZA").trim().toUpperCase();

  const partnerId = normalizeObjectIdLike(args.partnerId);
  if (!partnerId) throw new Error("partnerId is required");

  const providerId = normalizeObjectIdLike(args.providerId);

  const month = normalizeMonth(args.month);
  const from = parseDateParam(args.from);
  const to = parseDateParam(args.to);

  let rangeStart = null;
  let rangeEnd = null;

  if (month) {
    const r = parseMonthToRange(month);
    rangeStart = r.start;
    rangeEnd = r.end;
  } else if (from && to) {
    const start = new Date(from);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 1); // inclusive-to -> exclusive
    rangeStart = start;
    rangeEnd = end;
  } else {
    throw new Error("Provide month=YYYY-MM OR from & to dates");
  }

  const partner = await InsurancePartner.findById(partnerId).select(
    "name partnerCode email phone billing contact contactEmail contactPhone billingEmail"
  );
  if (!partner) throw new Error("Partner not found");

  const filter = {
    countryCode,
    "insurance.enabled": true,
    "insurance.partnerId": partnerId,
    createdAt: { $gte: rangeStart, $lt: rangeEnd },
  };

  if (providerId) filter.assignedTo = providerId;

  const jobs = await Job.find(filter)
    .select(
      "status createdAt updatedAt roleNeeded pickupAddressText dropoffAddressText pricing insurance customer assignedTo"
    )
    .populate("assignedTo", "name email phone role")
    .populate("customer", "name email phone role")
    .sort({ createdAt: -1 })
    .lean();

  // Totals
  let totalJobs = 0;

  // ✅ Gross amount partner owes you (NO deductions)
  let totalPartnerAmountDue = 0;

  // ✅ Booking fee / commission you keep (informational)
  let totalBookingFeeWaived = 0;
  let totalCommission = 0;

  // ✅ What you owe providers (net)
  let totalProviderAmountDue = 0;

  const currency = "ZAR";

  const items = jobs.map((j) => {
    totalJobs += 1;

    const estimatedTotal = Number(j?.pricing?.estimatedTotal || 0) || 0; // gross
    const bookingFee = Number(j?.pricing?.bookingFee || 0) || 0;
    const commission = Number(j?.pricing?.commissionAmount || 0) || 0;
    const providerDue = Number(j?.pricing?.providerAmountDue || 0) || 0; // net to provider

    totalPartnerAmountDue += estimatedTotal;
    totalBookingFeeWaived += bookingFee;
    totalCommission += commission;
    totalProviderAmountDue += providerDue;

    return {
      jobId: String(j?._id),
      shortId: String(j?._id).slice(-8).toUpperCase(),
      createdAt: toIso(j.createdAt),
      updatedAt: toIso(j.updatedAt),
      status: j.status,
      roleNeeded: j.roleNeeded,

      pickupAddressText: j.pickupAddressText || null,
      dropoffAddressText: j.dropoffAddressText || null,

      provider: j.assignedTo
        ? {
            providerId: String(j.assignedTo?._id || ""),
            name: j.assignedTo?.name || null,
            email: j.assignedTo?.email || null,
            phone: j.assignedTo?.phone || null,
          }
        : null,

      customer: j.customer
        ? {
            customerId: String(j.customer?._id || ""),
            name: j.customer?.name || null,
            email: j.customer?.email || null,
            phone: j.customer?.phone || null,
          }
        : null,

      pricing: {
        currency: j?.pricing?.currency || currency,
        estimatedTotal,
        bookingFee,
        commissionAmount: commission,
        providerAmountDue: providerDue,
        estimatedDistanceKm: Number(j?.pricing?.estimatedDistanceKm || 0) || 0,
      },

      insurance: {
        enabled: !!j?.insurance?.enabled,
        code: j?.insurance?.code || null,
        partnerId: String(j?.insurance?.partnerId || ""),
        validatedAt: toIso(j?.insurance?.validatedAt),
        partnerName: partner?.name || null,
        partnerCode: partner?.partnerCode || null,
      },
    };
  });

  /**
   * ✅ Grouped by provider with:
   * - gross (sum estimatedTotal)
   * - commission (sum commissionAmount)
   * - netDue (sum providerAmountDue)
   * - jobs covered
   */
  const byProvider = new Map();

  for (const it of items) {
    const pid = it?.provider?.providerId;
    if (!pid) continue;

    const cur = byProvider.get(pid) || {
      providerId: pid,
      name: it?.provider?.name || null,
      email: it?.provider?.email || null,
      phone: it?.provider?.phone || null,
      currency: it?.pricing?.currency || currency,

      jobCount: 0,
      grossTotal: 0,
      commissionTotal: 0,
      netTotalDue: 0,

      // Backward compat field name used by some UIs
      totalProviderAmountDue: 0,

      jobs: [],
    };

    cur.jobCount += 1;
    cur.grossTotal += Number(it?.pricing?.estimatedTotal || 0) || 0;
    cur.commissionTotal += Number(it?.pricing?.commissionAmount || 0) || 0;
    cur.netTotalDue += Number(it?.pricing?.providerAmountDue || 0) || 0;
    cur.totalProviderAmountDue = cur.netTotalDue;

    cur.jobs.push({
      jobId: it.jobId,
      shortId: it.shortId,
      createdAt: it.createdAt,
      status: it.status,
      pickupAddressText: it.pickupAddressText,
      dropoffAddressText: it.dropoffAddressText,
      estimatedTotal: it.pricing.estimatedTotal,
      commissionAmount: it.pricing.commissionAmount,
      providerAmountDue: it.pricing.providerAmountDue,
      insuranceCode: it.insurance.code || null,
    });

    if (!cur.name && it?.provider?.name) cur.name = it.provider.name;
    if (!cur.email && it?.provider?.email) cur.email = it.provider.email;
    if (!cur.phone && it?.provider?.phone) cur.phone = it.provider.phone;

    byProvider.set(pid, cur);
  }

  const groupedByProvider = Array.from(byProvider.values()).sort(
    (a, b) => (b.netTotalDue || 0) - (a.netTotalDue || 0)
  );

  return {
    partner: {
      partnerId: String(partner._id),
      name: partner.name,
      partnerCode: partner.partnerCode,
      email: partner.email || partner?.billingEmail || partner?.contactEmail || partner?.contact?.email || null,
      phone: partner.phone || partner?.contactPhone || partner?.contact?.phone || null,
    },
    countryCode,
    currency,
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

      // ✅ insurer claim (gross)
      totalPartnerAmountDue,

      // Backward-compat: older dashboards used this name
      totalEstimatedTotal: totalPartnerAmountDue,

      // informational
      totalBookingFeeWaived,
      totalCommission,

      // ✅ provider payments (net)
      totalProviderAmountDue,
    },
    items,
    groupedByProvider,
  };
}