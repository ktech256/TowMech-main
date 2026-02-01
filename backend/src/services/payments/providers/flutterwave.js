// src/services/payments/providers/flutterwave.js
/**
 * Flutterwave Provider (multi-country fallback)
 *
 * Supports:
 * - Create payment (hosted checkout link)
 * - Verify payment by transaction id OR tx_ref
 *
 * ENV REQUIRED:
 *   FLUTTERWAVE_SECRET_KEY
 *
 * ENV OPTIONAL:
 *   FLUTTERWAVE_BASE_URL (default: https://api.flutterwave.com)
 *   FLW_REDIRECT_URL     (default: process.env.APP_URL or "")
 *
 * NOTES:
 * - Flutterwave typically returns a hosted payment link.
 * - You should store tx_ref on your Payment model and verify after redirect/webhook.
 */

import axios from "axios";
import crypto from "crypto";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function baseUrl() {
  return String(process.env.FLUTTERWAVE_BASE_URL || "https://api.flutterwave.com").replace(/\/$/, "");
}

function authHeaders() {
  const secret = requireEnv("FLUTTERWAVE_SECRET_KEY");
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

function buildTxRef(prefix = "towmech") {
  // Unique reference for your system
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * ✅ Create Flutterwave payment
 *
 * payload:
 * {
 *   amount: number|string,
 *   currency: "ZAR"|"KES"|"UGX"|...,
 *   email: string,
 *   phone?: string,
 *   name?: string,
 *   tx_ref?: string,
 *   redirect_url?: string,
 *   meta?: object,
 *   title?: string,
 *   description?: string
 * }
 *
 * returns:
 * {
 *   provider: "flutterwave",
 *   method: "flutterwave",
 *   tx_ref,
 *   link,
 *   raw
 * }
 */
export async function flutterwaveCreatePayment(payload = {}) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

  const currency = String(payload.currency || "").trim().toUpperCase();
  if (!currency) throw new Error("currency is required");

  const email = String(payload.email || "").trim();
  if (!email) throw new Error("email is required");

  const name = String(payload.name || "TowMech User").trim();
  const phone = payload.phone ? String(payload.phone).trim() : "";

  const tx_ref = String(payload.tx_ref || buildTxRef("towmech")).trim();

  const redirect_url =
    String(payload.redirect_url || process.env.FLW_REDIRECT_URL || process.env.APP_URL || "").trim();

  // Flutterwave still allows redirect_url to be blank in some flows,
  // but it's best to always provide it if you can.
  const body = {
    tx_ref,
    amount: amount.toFixed(2), // Flutterwave accepts decimals
    currency,
    redirect_url: redirect_url || undefined,
    payment_options: "card,banktransfer,ussd,mobilemoney",
    customer: {
      email,
      name,
      phone_number: phone || undefined,
    },
    customizations: {
      title: String(payload.title || "TowMech Payment"),
      description: String(payload.description || "TowMech service payment"),
    },
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : undefined,
  };

  try {
    const res = await axios.post(`${baseUrl()}/v3/payments`, body, {
      headers: authHeaders(),
      timeout: 30000,
    });

    const data = res?.data;
    const link = data?.data?.link;

    if (!data || data?.status !== "success" || !link) {
      throw new Error(data?.message || "Flutterwave payment creation failed");
    }

    return {
      provider: "flutterwave",
      method: "flutterwave",
      tx_ref,
      link,
      raw: data,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Flutterwave payment creation failed";
    throw new Error(msg);
  }
}

/**
 * ✅ Verify Flutterwave payment
 *
 * You can verify via:
 * - transactionId (preferred after redirect/webhook)
 * - tx_ref (fallback: list/verify by reference)
 *
 * payload:
 * {
 *   transactionId?: string|number,
 *   tx_ref?: string
 * }
 *
 * returns:
 * {
 *   provider: "flutterwave",
 *   method: "flutterwave",
 *   status: "success"|"failed"|"pending",
 *   transactionId,
 *   tx_ref,
 *   amount,
 *   currency,
 *   raw
 * }
 */
export async function flutterwaveVerifyPayment(payload = {}) {
  const transactionId = payload.transactionId ? String(payload.transactionId).trim() : "";
  const tx_ref = payload.tx_ref ? String(payload.tx_ref).trim() : "";

  if (!transactionId && !tx_ref) {
    throw new Error("transactionId or tx_ref is required");
  }

  // If we have transactionId, use the direct verify endpoint
  if (transactionId) {
    try {
      const res = await axios.get(`${baseUrl()}/v3/transactions/${transactionId}/verify`, {
        headers: authHeaders(),
        timeout: 30000,
      });

      const data = res?.data;
      const d = data?.data;

      if (!data || data?.status !== "success" || !d) {
        throw new Error(data?.message || "Flutterwave verify failed");
      }

      const flwStatus = String(d?.status || "").toLowerCase();
      let status = "pending";
      if (flwStatus === "successful") status = "success";
      else if (flwStatus === "failed" || flwStatus === "cancelled") status = "failed";

      return {
        provider: "flutterwave",
        method: "flutterwave",
        status,
        transactionId: String(d?.id ?? transactionId),
        tx_ref: String(d?.tx_ref ?? tx_ref),
        amount: d?.amount,
        currency: d?.currency,
        raw: data,
      };
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Flutterwave verify failed";
      throw new Error(msg);
    }
  }

  // Fallback: if only tx_ref is provided, query transactions by tx_ref
  try {
    const res = await axios.get(`${baseUrl()}/v3/transactions`, {
      headers: authHeaders(),
      params: { tx_ref },
      timeout: 30000,
    });

    const data = res?.data;
    const list = data?.data;

    if (!data || data?.status !== "success" || !Array.isArray(list)) {
      throw new Error(data?.message || "Flutterwave verify by tx_ref failed");
    }

    // Choose the newest matching transaction (if multiple)
    const matches = list
      .filter((t) => String(t?.tx_ref || "") === tx_ref)
      .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));

    const d = matches[0];
    if (!d) {
      return {
        provider: "flutterwave",
        method: "flutterwave",
        status: "pending",
        transactionId: null,
        tx_ref,
        amount: null,
        currency: null,
        raw: data,
      };
    }

    const flwStatus = String(d?.status || "").toLowerCase();
    let status = "pending";
    if (flwStatus === "successful") status = "success";
    else if (flwStatus === "failed" || flwStatus === "cancelled") status = "failed";

    return {
      provider: "flutterwave",
      method: "flutterwave",
      status,
      transactionId: String(d?.id ?? ""),
      tx_ref: String(d?.tx_ref ?? tx_ref),
      amount: d?.amount,
      currency: d?.currency,
      raw: data,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Flutterwave verify by tx_ref failed";
    throw new Error(msg);
  }
}