import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

const PAYFAST_SANDBOX_URL = "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_LIVE_URL = "https://www.payfast.co.za/eng/process";

/**
 * ✅ PayFast encoding rules:
 * - encodeURIComponent
 * - spaces must be "+"
 */
function encodePayfast(value) {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/%2F/g, "/") // keep slashes readable (optional but matches PayFast often)
    .replace(/%3A/g, ":"); // keep : readable (optional)
}

/**
 * ✅ PayFast signature requires URL-encoded query string
 * (excluding signature)
 */
function generatePayfastSignature(params, passphrase = "") {
  const sortedKeys = Object.keys(params).sort();

  const queryString = sortedKeys
    .filter(
      (key) =>
        params[key] !== undefined &&
        params[key] !== null &&
        params[key] !== ""
    )
    .map((key) => `${key}=${encodePayfast(params[key].toString().trim())}`)
    .join("&");

  const finalString = passphrase
    ? `${queryString}&passphrase=${encodePayfast(passphrase.trim())}`
    : queryString;

  return crypto.createHash("md5").update(finalString).digest("hex");
}

/**
 * ✅ Load PayFast config
 * ✅ ENV FIRST → DB fallback
 */
async function getPayfastConfig() {
  const settings = await SystemSettings.findOne();
  const i = settings?.integrations || {};

  return {
    merchantId:
      process.env.PAYFAST_MERCHANT_ID ||
      i.payfastMerchantId ||
      i.paymentPublicKey ||
      "",

    merchantKey:
      process.env.PAYFAST_MERCHANT_KEY ||
      i.payfastMerchantKey ||
      i.paymentSecretKey ||
      "",

    passphrase:
      process.env.PAYFAST_PASSPHRASE ||
      i.payfastPassphrase ||
      i.paymentWebhookSecret ||
      "",

    mode: process.env.PAYFAST_MODE || i.payfastMode || "SANDBOX",
  };
}

/**
 * ✅ Create PayFast Payment URL
 */
async function createPayment({
  amount,
  reference,
  successUrl,
  cancelUrl,
  notifyUrl,
  customerEmail,
}) {
  const config = await getPayfastConfig();

  if (!config.merchantId || !config.merchantKey) {
    console.log("❌ PayFast config missing:", config);
    throw new Error("PayFast Merchant details missing ❌");
  }

  const mode = config.mode?.toUpperCase() === "LIVE" ? "LIVE" : "SANDBOX";
  const baseURL = mode === "LIVE" ? PAYFAST_LIVE_URL : PAYFAST_SANDBOX_URL;

  console.log("✅ PayFast MODE:", mode);
  console.log("✅ PayFast Base URL:", baseURL);
  console.log("✅ PayFast MerchantId:", config.merchantId);
  console.log("✅ PayFast MerchantKey:", config.merchantKey);
  console.log("✅ PayFast Passphrase:", config.passphrase ? "✅ present" : "❌ missing");

  // ✅ params must be EXACT & match PayFast documentation
  const params = {
    merchant_id: config.merchantId.trim(),
    merchant_key: config.merchantKey.trim(),
    return_url: successUrl.trim(),
    cancel_url: cancelUrl.trim(),
    notify_url: notifyUrl.trim(),
    m_payment_id: reference.trim(),
    amount: Number(amount).toFixed(2),
    item_name: "TowMech Booking Fee",
  };

  // ✅ Email is optional, remove if empty
  if (customerEmail && customerEmail.trim() !== "") {
    params.email_address = customerEmail.trim();
  }

  const signature = generatePayfastSignature(params, config.passphrase);

  const fullUrl =
    baseURL +
    "?" +
    Object.entries({ ...params, signature })
      .map(([k, v]) => `${k}=${encodePayfast(v.toString())}`)
      .join("&");

  console.log("✅ SIGNATURE:", signature);
  console.log("✅ PAYMENT URL GENERATED:", fullUrl);

  return {
    paymentUrl: fullUrl,
    reference,
    gateway: "PAYFAST",
    signature,
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