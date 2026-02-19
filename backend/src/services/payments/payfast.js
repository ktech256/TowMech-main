// backend/src/services/payments/payfast.js
import crypto from "crypto";

/**
 * PayFast endpoints
 */
const PAYFAST_SANDBOX_URL = "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_LIVE_URL = "https://www.payfast.co.za/eng/process";

/**
 * PayFast encoding:
 * - encodeURIComponent
 * - spaces must be "+"
 */
function encodePayfast(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

function buildParamString(params) {
  return Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodePayfast(String(v).trim())}`)
    .join("&");
}

function generatePayfastSignature(params, passphrase = "") {
  let paramString = buildParamString(params);

  if (passphrase && passphrase.trim() !== "") {
    paramString += `&passphrase=${encodePayfast(passphrase.trim())}`;
  }

  return crypto.createHash("md5").update(paramString).digest("hex");
}

/**
 * ✅ Load PayFast config per country from routing + ENV (ENV-first)
 * - Secrets should be ENV:
 *    PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE
 * - Non-secret "mode" may come from routing
 */
function loadPayfastConfig({ countryCode, routing }) {
  const providerDef = (routing?.providers || []).find(
    (p) => String(p?.gateway || "").toUpperCase() === "PAYFAST"
  );
  const cfg = providerDef?.config || {};

  const mode = String(cfg.mode || process.env.PAYFAST_MODE || "SANDBOX").toUpperCase();

  return {
    countryCode: String(countryCode || routing?.countryCode || "ZA").trim().toUpperCase(),
    merchantId: (process.env.PAYFAST_MERCHANT_ID || "").trim(),
    merchantKey: (process.env.PAYFAST_MERCHANT_KEY || "").trim(),
    passphrase: (process.env.PAYFAST_PASSPHRASE || "").trim(),
    mode: mode === "LIVE" ? "LIVE" : "SANDBOX",
    itemName: String(cfg.itemName || "TowMech Booking Fee"),
    merchantName: String(cfg.merchantName || "TowMech"),
  };
}

/**
 * ✅ Create PayFast Payment URL (unified adapter contract)
 */
async function createPayment({
  amount,
  currency,
  reference,
  successUrl,
  cancelUrl,
  notifyUrl,
  customerEmail,
  countryCode,
  routing,
}) {
  const config = loadPayfastConfig({ countryCode, routing });

  if (!config.merchantId || !config.merchantKey) {
    throw new Error("PayFast Merchant details missing (PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY) ❌");
  }

  const baseURL = config.mode === "LIVE" ? PAYFAST_LIVE_URL : PAYFAST_SANDBOX_URL;

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error(`Invalid amount for PayFast: ${amount}`);
  }

  const params = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    return_url: String(successUrl || "").trim(),
    cancel_url: String(cancelUrl || "").trim(),
    notify_url: String(notifyUrl || "").trim(),
    email_address: String(customerEmail || "").trim(),
    m_payment_id: String(reference || "").trim(),
    amount: numericAmount.toFixed(2),
    item_name: config.itemName,
  };

  if (!params.email_address) delete params.email_address;

  // ✅ Generate signature
  const signature = generatePayfastSignature(params, config.passphrase);

  // ✅ Build final URL (same ordering)
  const fullUrl = `${baseURL}?${buildParamString({ ...params, signature })}`;

  return {
    gateway: "PAYFAST",
    reference,
    paymentUrl: fullUrl,
    redirectUrl: fullUrl,
    signature,
    currency: (currency || "ZAR").toUpperCase(),
  };
}

async function verifyPayment() {
  return { message: "PayFast verification handled via notify_url ITN ✅" };
}

export default {
  provider: "PAYFAST",
  createPayment,
  verifyPayment,
};