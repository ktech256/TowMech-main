// backend/src/services/payments/peachPayments.js
import axios from "axios";

/**
 * Peach Payments base URLs
 */
const PEACH_SANDBOX_URL = "https://test.oppwa.com/v1/checkouts";
const PEACH_LIVE_URL = "https://oppwa.com/v1/checkouts";

/**
 * ✅ Load Peach config per country from routing + ENV (ENV-first)
 * Secrets should be ENV:
 *   PEACH_ENTITY_ID, PEACH_ACCESS_TOKEN, PEACH_MODE
 * Optional per-country overrides may exist in routing config (non-secret).
 */
function loadPeachConfig({ countryCode, routing }) {
  const providerDef = (routing?.providers || []).find(
    (p) => String(p?.gateway || "").toUpperCase() === "PEACH_PAYMENTS"
  );
  const cfg = providerDef?.config || {};

  return {
    countryCode: String(countryCode || routing?.countryCode || "ZA").trim().toUpperCase(),
    entityId: String(process.env.PEACH_ENTITY_ID || cfg.entityId || cfg.entityID || "").trim(),
    accessToken: String(process.env.PEACH_ACCESS_TOKEN || "").trim(), // keep secrets in ENV
    mode: String(process.env.PEACH_MODE || cfg.mode || "SANDBOX").toUpperCase(),
  };
}

/**
 * ✅ Create Peach Checkout (unified adapter contract)
 *
 * NOTE: Peach is usually "SDK" / hosted checkout flow depending on your frontend.
 * For now we create a checkoutId that your webview/redirect can use if you have that flow.
 */
async function createPayment({
  amount,
  currency,
  reference,
  successUrl, // not used by Peach directly in this endpoint
  cancelUrl, // not used directly here
  countryCode,
  routing,
}) {
  const config = loadPeachConfig({ countryCode, routing });

  if (!config.entityId || !config.accessToken) {
    throw new Error("Peach Payments keys missing (PEACH_ENTITY_ID / PEACH_ACCESS_TOKEN) ❌");
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error(`Invalid amount for Peach: ${amount}`);
  }

  const baseURL = config.mode === "LIVE" ? PEACH_LIVE_URL : PEACH_SANDBOX_URL;

  const params = new URLSearchParams();
  params.append("entityId", config.entityId);
  params.append("amount", numericAmount.toFixed(2));
  params.append("currency", (currency || "ZAR").toUpperCase());
  params.append("paymentType", "DB");
  params.append("merchantTransactionId", String(reference || "").trim());

  const response = await axios.post(baseURL, params, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 30000,
  });

  // You likely need a hosted page / payment widget flow to actually pay using checkoutId.
  // Return checkoutId as sdkParams placeholder for now.
  return {
    gateway: "PEACH_PAYMENTS",
    reference,
    checkoutId: response?.data?.id,
    sdkParams: { checkoutId: response?.data?.id, mode: config.mode },
    raw: response.data,
  };
}

async function verifyPayment({ checkoutId, countryCode, routing }) {
  const config = loadPeachConfig({ countryCode, routing });

  if (!config.entityId || !config.accessToken) {
    throw new Error("Peach Payments keys missing (PEACH_ENTITY_ID / PEACH_ACCESS_TOKEN) ❌");
  }

  const id = String(checkoutId || "").trim();
  if (!id) throw new Error("checkoutId is required for Peach verify");

  const baseURL =
    config.mode === "LIVE"
      ? `https://oppwa.com/v1/checkouts/${encodeURIComponent(id)}/payment`
      : `https://test.oppwa.com/v1/checkouts/${encodeURIComponent(id)}/payment`;

  const response = await axios.get(`${baseURL}?entityId=${encodeURIComponent(config.entityId)}`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    timeout: 30000,
  });

  return response.data;
}

export default {
  provider: "PEACH_PAYMENTS",
  createPayment,
  verifyPayment,
};