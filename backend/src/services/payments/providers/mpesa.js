// src/services/payments/providers/mpesa.js
/**
 * M-Pesa Provider (Kenya)
 *
 * Supports:
 * - STK Push request (Customer prompt on phone)
 * - STK Push query/verify (check status)
 *
 * ENV REQUIRED:
 *   MPESA_CONSUMER_KEY
 *   MPESA_CONSUMER_SECRET
 *   MPESA_SHORTCODE
 *   MPESA_PASSKEY
 *   MPESA_CALLBACK_URL
 *
 * ENV OPTIONAL:
 *   MPESA_ENV=sandbox|production  (default: sandbox)
 *   MPESA_BASE_URL               (override)
 *
 * NOTES:
 * - Amount is in KES (no cents)
 * - Phone must be in 2547XXXXXXXX format (E.164 without + OR with +254...)
 */

import axios from "axios";
import crypto from "crypto";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function normalizeMpesaPhone(phone) {
  if (!phone) return "";
  let p = String(phone).trim();
  p = p.replace(/\s+/g, "");
  p = p.replace(/[-()]/g, "");

  // allow +2547...
  if (p.startsWith("+")) p = p.slice(1);

  // allow 07xxxxxxxx
  if (/^0\d{9}$/.test(p)) {
    // convert 07.. -> 2547..
    return `254${p.slice(1)}`;
  }

  // allow 7xxxxxxxx
  if (/^7\d{8}$/.test(p)) {
    return `254${p}`;
  }

  // allow 2547xxxxxxxx
  if (/^2547\d{8}$/.test(p)) return p;

  return p; // might fail later, but keep it for debugging
}

function mpesaBaseUrl() {
  const env = String(process.env.MPESA_ENV || "sandbox").toLowerCase();
  if (process.env.MPESA_BASE_URL) return String(process.env.MPESA_BASE_URL).replace(/\/$/, "");

  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getMpesaAccessToken() {
  const consumerKey = requireEnv("MPESA_CONSUMER_KEY");
  const consumerSecret = requireEnv("MPESA_CONSUMER_SECRET");

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const res = await axios.get(`${mpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
    timeout: 30000,
  });

  const token = res?.data?.access_token;
  if (!token) throw new Error("Failed to obtain M-Pesa access token");

  return token;
}

function getTimestamp() {
  // format: YYYYMMDDHHmmss
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

function getMpesaPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

/**
 * ✅ Create M-Pesa STK Push Payment
 *
 * payload:
 * {
 *   amount: number (KES)
 *   phone: string (07.. or +2547.. or 2547..)
 *   reference?: string
 *   description?: string
 * }
 *
 * returns:
 * {
 *   provider: "mpesa",
 *   method: "mpesa",
 *   reference,
 *   checkoutRequestId,
 *   merchantRequestId,
 *   raw
 * }
 */
export async function mpesaCreatePayment(payload = {}) {
  const shortcode = requireEnv("MPESA_SHORTCODE");
  const passkey = requireEnv("MPESA_PASSKEY");
  const callbackUrl = requireEnv("MPESA_CALLBACK_URL");

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

  const phone = normalizeMpesaPhone(payload.phone);
  if (!/^2547\d{8}$/.test(phone)) {
    throw new Error("Invalid phone for M-Pesa. Use 07XXXXXXXX or 2547XXXXXXXX");
  }

  const reference = String(payload.reference || crypto.randomBytes(8).toString("hex")).trim();
  const description = String(payload.description || "TowMech Payment").trim();

  const timestamp = getTimestamp();
  const password = getMpesaPassword(shortcode, passkey, timestamp);

  const token = await getMpesaAccessToken();

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.round(amount), // KES integer
    PartyA: phone,
    PartyB: shortcode,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: reference,
    TransactionDesc: description,
  };

  try {
    const res = await axios.post(`${mpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    const data = res?.data;

    if (!data || data?.ResponseCode !== "0") {
      throw new Error(data?.ResponseDescription || "M-Pesa STK Push failed");
    }

    return {
      provider: "mpesa",
      method: "mpesa",
      reference,
      checkoutRequestId: data?.CheckoutRequestID,
      merchantRequestId: data?.MerchantRequestID,
      raw: data,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.errorMessage ||
      err?.response?.data?.ResponseDescription ||
      err?.message ||
      "M-Pesa STK Push failed";
    throw new Error(msg);
  }
}

/**
 * ✅ Verify M-Pesa STK Push Payment (Query)
 *
 * payload:
 * {
 *   checkoutRequestId: string
 * }
 *
 * returns:
 * {
 *   provider: "mpesa",
 *   method: "mpesa",
 *   checkoutRequestId,
 *   status: "success" | "failed" | "pending",
 *   resultCode,
 *   resultDesc,
 *   raw
 * }
 */
export async function mpesaVerifyPayment(payload = {}) {
  const shortcode = requireEnv("MPESA_SHORTCODE");
  const passkey = requireEnv("MPESA_PASSKEY");

  const checkoutRequestId = String(payload.checkoutRequestId || "").trim();
  if (!checkoutRequestId) throw new Error("checkoutRequestId is required");

  const timestamp = getTimestamp();
  const password = getMpesaPassword(shortcode, passkey, timestamp);

  const token = await getMpesaAccessToken();

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  try {
    const res = await axios.post(`${mpesaBaseUrl()}/mpesa/stkpushquery/v1/query`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    const data = res?.data;
    const resultCode = String(data?.ResultCode ?? "");
    const resultDesc = String(data?.ResultDesc ?? "");

    // ResultCode "0" means paid
    // Common pending: "1032" / others
    let status = "pending";
    if (resultCode === "0") status = "success";
    else if (resultCode && resultCode !== "0") status = "failed";

    return {
      provider: "mpesa",
      method: "mpesa",
      checkoutRequestId,
      status,
      resultCode,
      resultDesc,
      raw: data,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.errorMessage ||
      err?.response?.data?.ResultDesc ||
      err?.message ||
      "M-Pesa verify failed";
    throw new Error(msg);
  }
}