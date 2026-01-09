import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

/**
 * ✅ PayFast base URLs
 */
const PAYFAST_SANDBOX_URL = "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_LIVE_URL = "https://www.payfast.co.za/eng/process";

/**
 * ✅ Generate PayFast signature
 * PayFast uses MD5 signature of query string
 */
function generatePayfastSignature(params, passphrase) {
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys
    .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`)
    .join("&");

  const finalString = passphrase
    ? `${queryString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`
    : queryString;

  return crypto.createHash("md5").update(finalString).digest("hex");
}

/**
 * ✅ Load PayFast config from DB
 */
async function getPayfastConfig() {
  const settings = await SystemSettings.findOne();
  const i = settings?.integrations || {};

  return {
    merchantId: i.payfastMerchantId || "",
    merchantKey: i.payfastMerchantKey || "",
    passphrase: i.payfastPassphrase || "",
    mode: i.payfastMode || "SANDBOX",
  };
}

/**
 * ✅ Create PayFast Payment URL
 */
async function createPayment({ amount, reference, successUrl, cancelUrl, notifyUrl, customerEmail }) {
  const config = await getPayfastConfig();

  if (!config.merchantId || !config.merchantKey) {
    throw new Error("PayFast Merchant details missing ❌");
  }

  const baseURL = config.mode === "LIVE" ? PAYFAST_LIVE_URL : PAYFAST_SANDBOX_URL;

  const params = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    return_url: successUrl,
    cancel_url: cancelUrl,
    notify_url: notifyUrl,
    email_address: customerEmail,
    m_payment_id: reference,
    amount: amount.toFixed(2),
    item_name: "TowMech Booking Fee",
  };

  const signature = generatePayfastSignature(params, config.passphrase);

  const fullUrl =
    baseURL +
    "?" +
    Object.entries({ ...params, signature })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");

  return {
    paymentUrl: fullUrl,
    reference,
  };
}

/**
 * ✅ Verify PayFast is handled by webhook notify endpoint
 * We'll implement notify endpoint later.
 */
async function verifyPayment() {
  return { message: "PayFast verification handled via notify_url webhook ✅" };
}

export default {
  provider: "PAYFAST",
  createPayment,
  verifyPayment,
};