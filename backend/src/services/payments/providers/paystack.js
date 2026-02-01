// src/services/payments/providers/paystack.js
/**
 * Paystack Provider (TowMech Global)
 * - Create payment (initialize transaction)
 * - Verify payment (verify transaction by reference)
 *
 * ENV REQUIRED (prod):
 *   PAYSTACK_SECRET_KEY
 *   PAYSTACK_PUBLIC_KEY (optional, mostly for frontend)
 *
 * ENV OPTIONAL:
 *   PAYSTACK_BASE_URL (defaults to https://api.paystack.co)
 *
 * Notes:
 * - Paystack amount is in the smallest currency unit.
 *   For ZAR/NGN/etc: 100.00 => 10000 (cents/kobo)
 */

import axios from "axios";

const PAYSTACK_BASE_URL = (process.env.PAYSTACK_BASE_URL || "https://api.paystack.co").replace(
  /\/$/,
  ""
);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function toMinorUnits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

function pickCurrency(payload) {
  // Paystack supports multiple currencies in some regions; you control currency via payload/config
  const c = String(payload?.currency || "ZAR").trim().toUpperCase();
  return c;
}

function buildBearerHeaders() {
  const secret = requireEnv("PAYSTACK_SECRET_KEY");
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

/**
 * ✅ Create Paystack payment
 *
 * Expected payload:
 * {
 *   amount: number (major units e.g. 100.50)
 *   currency: "ZAR"
 *   email: "user@email.com"
 *   reference?: "optional"
 *   callbackUrl?: "optional"
 *   metadata?: object
 * }
 *
 * Returns:
 * {
 *   provider: "paystack",
 *   method: "paystack",
 *   reference,
 *   authorizationUrl,
 *   accessCode,
 *   raw
 * }
 */
export async function paystackCreatePayment(payload = {}) {
  const email = String(payload.email || "").trim();
  if (!email) throw new Error("Paystack requires customer email");

  const currency = pickCurrency(payload);
  const amountMinor = toMinorUnits(payload.amount);

  const body = {
    email,
    amount: amountMinor,
    currency,
  };

  if (payload.reference) body.reference = String(payload.reference).trim();
  if (payload.callbackUrl) body.callback_url = String(payload.callbackUrl).trim();
  if (payload.metadata && typeof payload.metadata === "object") body.metadata = payload.metadata;

  try {
    const res = await axios.post(`${PAYSTACK_BASE_URL}/transaction/initialize`, body, {
      headers: buildBearerHeaders(),
      timeout: 30000,
    });

    const data = res?.data;
    if (!data?.status) {
      throw new Error(data?.message || "Paystack initialize failed");
    }

    const reference = data?.data?.reference || body.reference || null;

    return {
      provider: "paystack",
      method: "paystack",
      reference,
      authorizationUrl: data?.data?.authorization_url,
      accessCode: data?.data?.access_code,
      raw: data,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Paystack initialize failed";
    throw new Error(msg);
  }
}

/**
 * ✅ Verify Paystack payment
 *
 * Expected payload:
 * {
 *   reference: "abc123"
 * }
 *
 * Returns:
 * {
 *   provider: "paystack",
 *   method: "paystack",
 *   reference,
 *   status: "success" | "failed" | "abandoned" | ...,
 *   paid: boolean,
 *   amount: number (major units),
 *   currency,
 *   raw
 * }
 */
export async function paystackVerifyPayment(payload = {}) {
  const reference = String(payload.reference || "").trim();
  if (!reference) throw new Error("Paystack verify requires reference");

  try {
    const res = await axios.get(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: buildBearerHeaders(),
      timeout: 30000,
    });

    const data = res?.data;
    if (!data?.status) {
      throw new Error(data?.message || "Paystack verify failed");
    }

    const status = data?.data?.status; // "success", "failed", "abandoned"
    const amountMinor = Number(data?.data?.amount || 0);
    const currency = String(data?.data?.currency || "").toUpperCase();

    return {
      provider: "paystack",
      method: "paystack",
      reference,
      status,
      paid: status === "success",
      amount: amountMinor / 100,
      currency,
      raw: data,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Paystack verify failed";
    throw new Error(msg);
  }
}