// backend/src/services/payments/providers/paypal.js
import axios from "axios";

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function getProviderConfig(payload) {
  const routing = payload?.routing;
  const providers = Array.isArray(routing?.providers) ? routing.providers : [];
  const def = providers.find((p) => String(p?.gateway || "").toUpperCase() === "PAYPAL");
  return safeObj(def?.config);
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function requireValue(name, v) {
  if (!v) throw new Error(`Missing required value: ${name}`);
  return v;
}

function getBaseUrl(payload) {
  const cfg = getProviderConfig(payload);
  // allow explicit baseUrl, else infer from env
  const env = String(cfg.env || process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  if (cfg.baseUrl) return String(cfg.baseUrl).replace(/\/$/, "");
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function getCreds(payload) {
  const cfg = getProviderConfig(payload);

  const clientId = pickFirst(cfg.clientId, process.env.PAYPAL_CLIENT_ID);
  const secret = pickFirst(cfg.secretKey, cfg.clientSecret, process.env.PAYPAL_CLIENT_SECRET);

  requireValue("PAYPAL_CLIENT_ID", clientId);
  requireValue("PAYPAL_CLIENT_SECRET", secret);

  return { clientId, secret };
}

async function getAccessToken(payload) {
  const { clientId, secret } = getCreds(payload);
  const baseUrl = getBaseUrl(payload);

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const res = await axios.post(`${baseUrl}/v1/oauth2/token`, "grant_type=client_credentials", {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 30000,
  });

  const token = res?.data?.access_token;
  if (!token) throw new Error("Failed to obtain PayPal access token");
  return token;
}

export async function paypalCreatePayment(payload = {}) {
  const baseUrl = getBaseUrl(payload);
  const token = await getAccessToken(payload);

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

  const currency = String(payload.currency || "USD").trim().toUpperCase();
  const reference = String(payload.reference || "").trim();
  if (!reference) throw new Error("PayPal requires reference");

  const successUrl = String(payload.successUrl || "").trim();
  const cancelUrl = String(payload.cancelUrl || "").trim();
  if (!successUrl || !cancelUrl) throw new Error("PayPal requires successUrl and cancelUrl");

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: reference,
        amount: {
          currency_code: currency,
          value: amount.toFixed(2),
        },
      },
    ],
    application_context: {
      return_url: successUrl,
      cancel_url: cancelUrl,
      brand_name: "TowMech",
      user_action: "PAY_NOW",
    },
  };

  const res = await axios.post(`${baseUrl}/v2/checkout/orders`, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  const order = res?.data;
  const links = Array.isArray(order?.links) ? order.links : [];
  const approve = links.find((l) => String(l?.rel || "").toLowerCase() === "approve");

  return {
    provider: "paypal",
    method: "paypal",
    reference,
    orderId: order?.id || null,
    redirectUrl: approve?.href || null,
    paymentUrl: approve?.href || null,
    raw: order,
  };
}

export async function paypalCaptureOrder(payload = {}) {
  const baseUrl = getBaseUrl(payload);
  const token = await getAccessToken(payload);

  const orderId = String(payload.orderId || "").trim();
  if (!orderId) throw new Error("orderId is required");

  const res = await axios.post(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  const data = res?.data;
  const status = String(data?.status || "").toUpperCase(); // COMPLETED etc

  return {
    provider: "paypal",
    method: "paypal",
    orderId,
    status,
    paid: status === "COMPLETED",
    raw: data,
  };
}

export async function paypalVerifyPayment(payload = {}) {
  const baseUrl = getBaseUrl(payload);
  const token = await getAccessToken(payload);

  const orderId = String(payload.orderId || "").trim();
  if (!orderId) throw new Error("orderId is required");

  const res = await axios.get(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });

  const data = res?.data;
  const status = String(data?.status || "").toUpperCase();

  return {
    provider: "paypal",
    method: "paypal",
    orderId,
    status,
    paid: status === "COMPLETED",
    raw: data,
  };
}