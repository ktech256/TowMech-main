// backend/src/services/insurance/codeService.js
import crypto from "crypto";
import InsuranceCode from "../../models/InsuranceCode.js";
import InsurancePartner from "../../models/InsurancePartner.js";

/**
 * Generate a random code (no confusing chars)
 */
function generateRandomCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // removed I,O,0,1
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Create many codes for a partner
 */
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
      // duplicate collision - just retry
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

/**
 * Validate a code for a selected partner.
 * - strict partner match
 * - country match
 * - active
 * - not expired
 * - usage remaining
 */
export async function validateInsuranceCode({ partnerId, code, countryCode = "ZA", phone = "", email = "" }) {
  if (!partnerId) throw new Error("partnerId is required");
  if (!code) throw new Error("code is required");

  const normalizedCode = String(code).trim().toUpperCase();
  const normalizedCountry = String(countryCode || "ZA").trim().toUpperCase();

  const doc = await InsuranceCode.findOne({
    partner: partnerId,
    code: normalizedCode,
    countryCode: normalizedCountry,
    isActive: true,
  });

  if (!doc) return { ok: false, message: "Invalid code" };

  if (!doc.expiresAt || doc.expiresAt < new Date()) {
    return { ok: false, message: "Code expired" };
  }

  if (typeof doc.canUse === "function" && !doc.canUse()) {
    return { ok: false, message: "Code already used" };
  }

  // optional restrictions
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
 * Mark a code as used.
 * Call this AFTER job creation (insurance booking) succeeds.
 */
export async function markInsuranceCodeUsed({ partnerId, code, countryCode = "ZA", userId = null, jobId = null }) {
  if (!partnerId) throw new Error("partnerId is required");
  if (!code) throw new Error("code is required");

  const normalizedCode = String(code).trim().toUpperCase();
  const normalizedCountry = String(countryCode || "ZA").trim().toUpperCase();

  const doc = await InsuranceCode.findOne({
    partner: partnerId,
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

  // NOTE: jobId is accepted for future enhancement (not stored unless schema supports it)
  // You can later add doc.usage.lastUsedJobId = jobId if you introduce that field.

  await doc.save();

  return {
    ok: true,
    message: "Code marked as used ✅",
    usedCount: doc.usage.usedCount,
    maxUses: doc.usage.maxUses,
    jobId: jobId || null,
  };
}

/**
 * Revoke/disable a code
 */
export async function disableInsuranceCode({ codeId, updatedBy = null }) {
  if (!codeId) throw new Error("codeId is required");

  const doc = await InsuranceCode.findById(codeId);
  if (!doc) throw new Error("InsuranceCode not found");

  doc.isActive = false;
  doc.updatedBy = updatedBy;

  await doc.save();

  return { ok: true, message: "Code disabled ✅" };
}

/**
 * Generate cryptographically strong invoice reference for insurance jobs
 * (useful in future invoices)
 */
export function generateInsuranceInvoiceRef(prefix = "INS") {
  const rand = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `${prefix}-${rand}`;
}