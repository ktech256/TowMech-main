import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

/**
 * ✅ PayFast base URLs
 */
const PAYFAST_SANDBOX_URL = "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_LIVE_URL = "https://www.payfast.co.za/eng/process";

/**
 * ✅ Generate PayFast signature
 * PayFast requires MD5 hash of query string
 */
function generatePayfastSignature(params, passphrase) {
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`)
    .join("&");

  const finalString = passphrase
    ? `${queryString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`
    : queryString;

  return crypto.createHash("md5").update(finalString).digest("hex");
}

/**
 * ✅ Load PayFast config
 * DB fields first, but PAYFAST_MODE ALWAYS comes from ENV (if set)
 */
async function getPayfastConfig() {
  const settings = await SystemSettings.findOne();
  const i = settings?.integrations || {};

  // ✅ Merchant ID
  const merchantId =
    i.payfastMerchantId ||
    i.paymentPublicKey ||
    process.env.PAYFAST_MERCHANT_ID ||
    "";

  // ✅ Merchant Key
  const merchantKey =
    i.payfastMerchantKey ||
    i.paymentSecretKey ||
    process.env.PAYFAST_MERCHANT_KEY ||
    "";

  // ✅ Passphrase
  const passphrase =
    i.payfastPassphrase ||
    i.paymentWebhookSecret ||
    process.env.PAYFAST_PASSPHRASE ||
    "";

  // ✅ MODE MUST FOLLOW ENV FIRST (because PayFast dashboard doesn't supply sandbox)
  const mode =
    process.env.PAYFAST_MODE ||
    i.payfastMode ||
    "LIVE";

  return {
    merchantId,
    merchantKey,
    passphrase,
    mode: mode.toUpperCase(),
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

  const baseURL =
    config.mode === "LIVE"
      ? PAYFAST_LIVE_URL
      : PAYFAST_SANDBOX_URL;

  console.log("✅ PayFast MODE:", config.mode);
  console.log("✅ PayFast Base URL:", baseURL);
  console.log("✅ PayFast MerchantId:", config.merchantId);
  console.log("✅ PayFast MerchantKey:", config.merchantKey);
  console.log("✅ PayFast Passphrase:", config.passphrase ? "✅ present" : "❌ missing");

  // ✅ IMPORTANT: PayFast signature relies on consistent param order
  const params = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    return_url: successUrl,
    cancel_url: cancelUrl,
    notify_url: notifyUrl,
    email_address: customerEmail,
    m_payment_id: reference,
    amount: Number(amount).toFixed(2),
    item_name: "TowMech Booking Fee",
  };

  const signature = generatePayfastSignature(params, config.passphrase);

  const fullUrl =
    baseURL +
    "?" +
    Object.entries({ ...params, signature })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");

  console.log("✅ PAYMENT URL GENERATED:", fullUrl);

  return {
    paymentUrl: fullUrl,
    reference,
    gateway: "PAYFAST",
    signature,
  };
}

/**
 * ✅ PayFast verification happens via ITN notify_url callback
 */
async function verifyPayment() {
  return { message: "PayFast verification handled via notify_url ITN ✅" };
}

export default {
  provider: "PAYFAST",
  createPayment,
  verifyPayment,
};