// backend/src/services/insurance/codeService.js
import crypto from "crypto";
import mongoose from "mongoose";
import InsuranceCode from "../../models/InsuranceCode.js";
import InsurancePartner from "../../models/InsurancePartner.js";

function generateRandomCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function generateCodesForPartner({
  partnerId,
  countryCode = "ZA",
  count = 50,
  length = 8,
  expiresInDays = 365,
  maxUses = 1,
  createdBy = null,
}) {
  if (!partnerId) throw new Error("partnerId is required");
  if (!count || count < 1) throw new Error("count must be >= 1");
  if (!length || length < 4) throw new Error("length must be >= 4");

  const partner = await InsurancePartner.findById(partnerId);
  if (!partner) throw new Error("InsurancePartner not found");

  const partnerCode = String(partner.partnerCode || "").trim().toUpperCase();
  if (!partnerCode) throw new Error("Partner missing partnerCode");

  const normalizedCountry = String(countryCode || "ZA").trim().toUpperCase();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const created = [];
  const attemptsLimit = count * 20;

  let attempts = 0;
  while (created.length < count && attempts < attemptsLimit) {
    attempts++;

    const code = generateRandomCode(length);

    try {
      const doc = await InsuranceCode.create({
        partner: partner._id,
        partnerCode,
        code,
        countryCode: normalizedCountry,
        expiresAt,
        usage: {
          usedCount: 0,
          maxUses: maxUses || 1,
          lastUsedAt: null,
          lastUsedByUser: null,
        },
        createdBy,
        updatedBy: createdBy,
      });

      created.push(doc);
    } catch (err) {
      if (String(err?.message || "").toLowerCase().includes("duplicate")) continue;
      throw err;
    }
  }

  if (created.length < count) {
    throw new Error(
      `Could not generate enough unique codes. Requested=${count}, generated=${created.length}`
    );
  }

  return {
    partner: {
      id: partner._id,
      name: partner.name,
      partnerCode,
    },
    countryCode: normalizedCountry,
    count: created.length,
    expiresAt,
    codes: created.map((c) => c.code),
  };
}

export async function validateInsuranceCode({
  partnerId,
  code,
  countryCode = "ZA",
  phone = "",
  email = "",
}) {
  if (!code) throw new Error("code is required");

  const normalizedCode = String(code).trim().toUpperCase();
  const normalizedCountry = String(countryCode || "ZA").trim().toUpperCase();

  const query = {
    ...(partnerId ? { partner: partnerId } : {}),
    code: normalizedCode,
    countryCode: normalizedCountry,
    isActive: true,
  };

  const doc = partnerId
    ? await InsuranceCode.findOne(query)
    : await InsuranceCode.findOne(query).sort({ createdAt: -1 });

  if (!partnerId) {
    const count = await InsuranceCode.countDocuments(query);
    if (count > 1) {
      return {
        ok: false,
        message:
          "Insurance code matches multiple partners for this country. Please contact support or regenerate codes.",
      };
    }
  }

  if (!doc) return { ok: false, message: "Invalid code" };

  if (!doc.expiresAt || doc.expiresAt < new Date()) {
    return { ok: false, message: "Code expired" };
  }

  if (typeof doc.canUse === "function" && !doc.canUse()) {
    return { ok: false, message: "Code already used" };
  }

  // 🔒 if locked by someone else (and lock not expired), block
  if (doc.lock && doc.lock.isLocked) {
    const until = doc.lock.lockedUntil ? new Date(doc.lock.lockedUntil) : null;
    const by = doc.lock.lockedByUser ? String(doc.lock.lockedByUser) : null;
    const now = new Date();

    if (until && until > now) {
      return {
        ok: false,
        message: "Insurance code is currently locked. Try again.",
        code: "INSURANCE_CODE_LOCKED",
        lockedUntil: until,
        lockedByUser: by,
      };
    }
  }

  const boundPhone = String(doc.restrictions?.boundToPhone || "").trim();
  const boundEmail = String(doc.restrictions?.boundToEmail || "").trim().toLowerCase();

  if (boundPhone && String(phone || "").trim() !== boundPhone) {
    return { ok: false, message: "Code not valid for this phone number" };
  }

  if (boundEmail && String(email || "").trim().toLowerCase() !== boundEmail) {
    return { ok: false, message: "Code not valid for this email" };
  }

  return {
    ok: true,
    message: "Code valid ✅",
    code: {
      id: doc._id,
      partnerId: doc.partner,
      partnerCode: doc.partnerCode,
      code: doc.code,
      countryCode: doc.countryCode,
      expiresAt: doc.expiresAt,
      remainingUses: (doc.usage?.maxUses || 1) - (doc.usage?.usedCount || 0),
    },
  };
}

/**
 * ✅ Soft-lock a code for a short time window
 * - prevents other users from taking it while customer is in the flow
 * - does NOT increment usedCount
 * - partnerId is OPTIONAL (derived from code if missing)
 */
export async function lockInsuranceCodeForJob({
  partnerId = null,
  code,
  countryCode = "ZA",
  userId = null,
  jobId = null,
  ttlMinutes = 20,
}) {
  if (!code) throw new Error("code is required");

  const normalizedCode = String(code).trim().toUpperCase();
  const normalizedCountry = String(countryCode || "ZA").trim().toUpperCase();

  // derive partnerId if not supplied
  let resolvedPartnerId = partnerId;
  if (!resolvedPartnerId) {
    const found = await InsuranceCode.findOne({
      code: normalizedCode,
      countryCode: normalizedCountry,
      isActive: true,
    }).select("partner");
    if (!found?.partner) {
      return { ok: false, message: "Invalid code", code: "INSURANCE_INVALID" };
    }
    resolvedPartnerId = found.partner;
  }

  const until = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // Atomic lock:
  // - allow lock if not locked OR lock expired OR locked by same user/job (re-entrant)
  const filter = {
    partner: resolvedPartnerId,
    code: normalizedCode,
    countryCode: normalizedCountry,
    isActive: true,
    $or: [
      { "lock.isLocked": { $ne: true } },
      { "lock.lockedUntil": { $exists: false } },
      { "lock.lockedUntil": { $lte: new Date() } },
      ...(userId ? [{ "lock.lockedByUser": userId }] : []),
      ...(jobId ? [{ "lock.lockedByJob": jobId }] : []),
    ],
  };

  const update = {
    $set: {
      "lock.isLocked": true,
      "lock.lockedAt": new Date(),
      "lock.lockedUntil": until,
      "lock.lockedByUser": userId || null,
      "lock.lockedByJob": jobId || null,
    },
  };

  const doc = await InsuranceCode.findOneAndUpdate(filter, update, { new: true });

  if (!doc) {
    return {
      ok: false,
      message: "Insurance code could not be locked. Try again.",
      code: "INSURANCE_LOCK_FAILED",
    };
  }

  // final sanity
  if (!doc.expiresAt || doc.expiresAt < new Date()) {
    return { ok: false, message: "Code expired", code: "INSURANCE_EXPIRED" };
  }
  if (typeof doc.canUse === "function" && !doc.canUse()) {
    return { ok: false, message: "Code already used", code: "INSURANCE_ALREADY_USED" };
  }

  return {
    ok: true,
    message: "Code locked ✅",
    lockedUntil: doc.lock?.lockedUntil || until,
    partnerId: doc.partner,
    jobId: jobId || null,
  };
}

/**
 * ✅ Mark a code as used (INCREMENT usedCount)
 * MUST be called AFTER successful customer-provider pairing (assignment).
 *
 * partnerId is OPTIONAL (derived from code if missing).
 */
export async function markInsuranceCodeUsed({
  partnerId = null,
  code,
  countryCode = "ZA",
  userId = null,
  jobId = null,
}) {
  if (!code) throw new Error("code is required");

  const normalizedCode = String(code).trim().toUpperCase();
  const normalizedCountry = String(countryCode || "ZA").trim().toUpperCase();

  // derive partnerId if not supplied
  let resolvedPartnerId = partnerId;
  if (!resolvedPartnerId) {
    const found = await InsuranceCode.findOne({
      code: normalizedCode,
      countryCode: normalizedCountry,
      isActive: true,
    }).select("partner");
    if (!found?.partner) throw new Error("Invalid code");
    resolvedPartnerId = found.partner;
  }

  const doc = await InsuranceCode.findOne({
    partner: resolvedPartnerId,
    code: normalizedCode,
    countryCode: normalizedCountry,
    isActive: true,
  });

  if (!doc) return { ok: false, message: "Invalid code" };

  if (!doc.expiresAt || doc.expiresAt < new Date()) {
    return { ok: false, message: "Code expired" };
  }

  const used = doc.usage?.usedCount || 0;
  const max = doc.usage?.maxUses || 1;

  if (used >= max) {
    return { ok: false, message: "Code already used" };
  }

  doc.usage.usedCount = used + 1;
  doc.usage.lastUsedAt = new Date();
  doc.usage.lastUsedByUser = userId || null;

  // unlock after use
  if (doc.lock) {
    doc.lock.isLocked = false;
    doc.lock.lockedUntil = null;
    doc.lock.lockedByUser = null;
    doc.lock.lockedByJob = null;
    doc.lock.lockedAt = null;
  }

  await doc.save();

  return {
    ok: true,
    message: "Code marked as used ✅",
    usedCount: doc.usage.usedCount,
    maxUses: doc.usage.maxUses,
    jobId: jobId || null,
  };
}

export async function disableInsuranceCode({ codeId, updatedBy = null }) {
  if (!codeId) throw new Error("codeId is required");

  const doc = await InsuranceCode.findById(codeId);
  if (!doc) throw new Error("InsuranceCode not found");

  doc.isActive = false;
  doc.updatedBy = updatedBy;

  await doc.save();

  return { ok: true, message: "Code disabled ✅" };
}

export function generateInsuranceInvoiceRef(prefix = "INS") {
  const rand = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `${prefix}-${rand}`;
}