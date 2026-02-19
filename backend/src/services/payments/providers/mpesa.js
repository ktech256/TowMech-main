// backend/src/services/payments/providers/mpesa.js
import axios from "axios";
import crypto from "crypto";

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function getProviderConfig(payload) {
  const routing = payload?.routing;
  const providers = Array.isArray(routing?.providers) ? routing.providers : [];
  const def = providers.find((p) => String(p?.gateway || "").toUpperCase() === "MPESA");
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

function normalizeMpesaPhone(phone) {
  if (!phone) return "";
  let p = String(phone).trim().replace(/\s+/g, "").replace(/[-()]/g, "");
  if (p.startsWith("+")) p = p.slice(1);

  if (/^0\d{9}$/.test(p)) return `254${p.slice(1)}`;
  if (/^7\d{8}$/.test(p)) return `254${p}`;
  if (/^2547\d{8}$/.test(p)) return p;

  return p;
}

function mpesaBaseUrl(payload) {
  const cfg = getProviderConfig(payload);

  const explicit = pickFirst(cfg.baseUrl, process.env.MPESA_BASE_URL);
  if (explicit) return explicit.replace(/\/$/, "");

  const env = String(cfg.env || process.env.MPESA_ENV || "sandbox").toLowerCase();
  return env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

function getMpesaEnvConfig(payload) {
  const cfg = getProviderConfig(payload);

  const consumerKey = pickFirst(cfg.consumerKey, process.env.MPESA_CONSUMER_KEY);
  const consumerSecret = pickFirst(cfg.consumerSecret, process.env.MPESA_CONSUMER_SECRET);
  const shortcode = pickFirst(cfg.shortcode, process.env.MPESA_SHORTCODE);
  const passkey = pickFirst(cfg.passkey, process.env.MPESA_PASSKEY);
  const callbackUrl = pickFirst(cfg.callbackUrl, process.env.MPESA_CALLBACK_URL);

  requireValue("MPESA_CONSUMER_KEY", consumerKey);
  requireValue("MPESA_CONSUMER_SECRET", consumerSecret);
  requireValue("MPESA_SHORTCODE", shortcode);
  requireValue("MPESA_PASSKEY", passkey);
  requireValue("MPESA_CALLBACK_URL", callbackUrl);

  return { consumerKey, consumerSecret, shortcode, passkey, callbackUrl };
}

async function getMpesaAccessToken(payload) {
  const { consumerKey, consumerSecret } = getMpesaEnvConfig(payload);
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const res = await axios.get(`${mpesaBaseUrl(payload)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 30000,
  });

  const token = res?.data?.access_token;
  if (!token) throw new Error("Failed to obtain M-Pesa access token");
  return token;
}

function getTimestamp() {
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

export async function mpesaCreatePayment(payload = {}) {
  const { shortcode, passkey, callbackUrl } = getMpesaEnvConfig(payload);

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
  const token = await getMpesaAccessToken(payload);

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: shortcode,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: reference,
    TransactionDesc: description,
  };

  const res = await axios.post(`${mpesaBaseUrl(payload)}/mpesa/stkpush/v1/processrequest`, body, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
}

export async function mpesaVerifyPayment(payload = {}) {
  const { shortcode, passkey } = getMpesaEnvConfig(payload);

  const checkoutRequestId = String(payload.checkoutRequestId || "").trim();
  if (!checkoutRequestId) throw new Error("checkoutRequestId is required");

  const timestamp = getTimestamp();
  const password = getMpesaPassword(shortcode, passkey, timestamp);
  const token = await getMpesaAccessToken(payload);

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  const res = await axios.post(`${mpesaBaseUrl(payload)}/mpesa/stkpushquery/v1/query`, body, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 30000,
  });

  const data = res?.data;
  const resultCode = String(data?.ResultCode ?? "");
  const resultDesc = String(data?.ResultDesc ?? "");

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
}