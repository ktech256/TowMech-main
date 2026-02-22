// backend/src/services/payments/providers/paystack.js
import axios from "axios";

const DEFAULT_BASE_URL = "https://api.paystack.co";

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function getProviderConfig(payload) {
  const routing = payload?.routing;
  const providers = Array.isArray(routing?.providers) ? routing.providers : [];
  const def = providers.find((p) => String(p?.gateway || "").toUpperCase() === "PAYSTACK");
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

function toMinorUnits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

function pickCurrency(payload) {
  return String(payload?.currency || "ZAR").trim().toUpperCase();
}

function getBaseUrl(payload) {
  const cfg = getProviderConfig(payload);
  return pickFirst(cfg.baseUrl, process.env.PAYSTACK_BASE_URL, DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getSecretKey(payload) {
  const cfg = getProviderConfig(payload);
  const secret = pickFirst(cfg.secretKey, process.env.PAYSTACK_SECRET_KEY);
  return requireValue("PAYSTACK_SECRET_KEY", secret);
}

function buildBearerHeaders(payload) {
  const secret = getSecretKey(payload);
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

export async function paystackCreatePayment(payload = {}) {
  const email = String(payload.email || "").trim();
  if (!email) throw new Error("Paystack requires customer email");

  const currency = pickCurrency(payload);
  const amountMinor = toMinorUnits(payload.amount);

  const body = { email, amount: amountMinor, currency };

  if (payload.reference) body.reference = String(payload.reference).trim();
  if (payload.callbackUrl) body.callback_url = String(payload.callbackUrl).trim();
  if (payload.metadata && typeof payload.metadata === "object") body.metadata = payload.metadata;

  const baseUrl = getBaseUrl(payload);

  const res = await axios.post(`${baseUrl}/transaction/initialize`, body, {
    headers: buildBearerHeaders(payload),
    timeout: 30000,
  });

  const data = res?.data;
  if (!data?.status) throw new Error(data?.message || "Paystack initialize failed");

  const reference = data?.data?.reference || body.reference || null;
  const authorizationUrl = data?.data?.authorization_url;

  return {
    provider: "paystack",
    method: "paystack",
    reference,
    authorizationUrl,
    redirectUrl: authorizationUrl,
    accessCode: data?.data?.access_code,
    raw: data,
  };
}

export async function paystackVerifyPayment(payload = {}) {
  const reference = String(payload.reference || "").trim();
  if (!reference) throw new Error("Paystack verify requires reference");

  const baseUrl = getBaseUrl(payload);

  const res = await axios.get(
    `${baseUrl}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: buildBearerHeaders(payload), timeout: 30000 }
  );

  const data = res?.data;
  if (!data?.status) throw new Error(data?.message || "Paystack verify failed");

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
}

/**
 * ✅ Paystack Refund
 * POST /refund
 * body: { transaction: <id|reference>, amount?: <kobo> }
 *
 * We accept amount in MAJOR units (e.g. ZAR) and convert to kobo internally.
 * Refund may be async on Paystack; "status:true" means accepted.
 */
export async function paystackRefundPayment(payload = {}) {
  const baseUrl = getBaseUrl(payload);

  const transaction = String(payload.transaction || payload.reference || "").trim();
  if (!transaction) throw new Error("Paystack refund requires transaction (id or reference)");

  const body = { transaction };

  // Optional partial refund (payload.amount is MAJOR units)
  if (payload.amount !== undefined && payload.amount !== null) {
    const n = Number(payload.amount);
    if (Number.isFinite(n) && n > 0) {
      body.amount = toMinorUnits(n); // to kobo
    }
  }

  // Optional reason
  const reason = payload.reason ? String(payload.reason).trim() : null;
  if (reason) body.reason = reason;

  const res = await axios.post(`${baseUrl}/refund`, body, {
    headers: buildBearerHeaders(payload),
    timeout: 30000,
  });

  const data = res?.data;
  if (!data?.status) throw new Error(data?.message || "Paystack refund failed");

  const refundData = data?.data || null;

  const refundReference =
    refundData?.reference ||
    refundData?.refund_reference ||
    refundData?.id ||
    `PAYSTACK_REFUND-${Date.now()}`;

  const refundStatus = refundData?.status || null;

  return {
    provider: "paystack",
    method: "paystack",
    transaction,
    refundReference,
    refundStatus,
    raw: data,
  };
}