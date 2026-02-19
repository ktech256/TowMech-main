// backend/src/services/payments/providers/stripe.js
import axios from "axios";

const STRIPE_API_BASE = "https://api.stripe.com";

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function getProviderConfig(payload) {
  const routing = payload?.routing;
  const providers = Array.isArray(routing?.providers) ? routing.providers : [];
  const def = providers.find((p) => String(p?.gateway || "").toUpperCase() === "STRIPE");
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

// Stripe has “zero-decimal” currencies.
// This list is not exhaustive, but covers common ones. You can extend as needed.
const ZERO_DECIMAL = new Set([
  "BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF",
]);

function toMinorUnits(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid amount");
  const c = String(currency || "USD").toUpperCase();
  if (ZERO_DECIMAL.has(c)) return Math.round(n);
  return Math.round(n * 100);
}

function stripeHeaders(secretKey, extra = {}) {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    ...extra,
  };
}

function formEncode(obj) {
  const params = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    params.append(k, String(v));
  });
  return params.toString();
}

function getKeys(payload) {
  const cfg = getProviderConfig(payload);

  const secretKey = pickFirst(cfg.secretKey, process.env.STRIPE_SECRET_KEY);
  const publishableKey = pickFirst(cfg.publicKey, process.env.STRIPE_PUBLISHABLE_KEY);

  requireValue("STRIPE_SECRET_KEY", secretKey);
  requireValue("STRIPE_PUBLISHABLE_KEY", publishableKey);

  // Needed for ephemeral key creation; choose a stable default if not provided
  const apiVersion = pickFirst(cfg.apiVersion, process.env.STRIPE_API_VERSION, "2023-10-16");

  return { secretKey, publishableKey, apiVersion };
}

export async function stripeCreatePayment(payload = {}) {
  const { secretKey, publishableKey, apiVersion } = getKeys(payload);

  const currency = String(payload.currency || "USD").trim().toLowerCase();
  const amountMinor = toMinorUnits(payload.amount, currency);

  const reference = String(payload.reference || "").trim();
  if (!reference) throw new Error("Stripe requires reference");

  // Decide flowType from routing if provided (default: SDK)
  const flowType =
    String(payload?.flowType || payload?.providerFlowType || "")
      .trim()
      .toUpperCase() === "REDIRECT"
      ? "REDIRECT"
      : "SDK";

  if (flowType === "REDIRECT") {
    // Stripe Checkout Session
    const successUrl = String(payload.successUrl || "").trim();
    const cancelUrl = String(payload.cancelUrl || "").trim();
    if (!successUrl || !cancelUrl) {
      throw new Error("Stripe redirect requires successUrl and cancelUrl");
    }

    // Build Checkout Session with one line item
    const body = new URLSearchParams();
    body.append("mode", "payment");
    body.append("success_url", successUrl);
    body.append("cancel_url", cancelUrl);

    // Reference so you can reconcile later
    body.append("client_reference_id", reference);

    body.append("line_items[0][quantity]", "1");
    body.append("line_items[0][price_data][currency]", currency);
    body.append("line_items[0][price_data][unit_amount]", String(amountMinor));
    body.append("line_items[0][price_data][product_data][name]", "TowMech Booking Fee");

    const res = await axios.post(`${STRIPE_API_BASE}/v1/checkout/sessions`, body.toString(), {
      headers: stripeHeaders(secretKey),
      timeout: 30000,
    });

    const session = res?.data;
    const url = session?.url || null;

    return {
      provider: "stripe",
      method: "stripe",
      flowType: "REDIRECT",
      reference,
      checkoutSessionId: session?.id || null,
      redirectUrl: url,
      paymentUrl: url,
      raw: session,
    };
  }

  // SDK flow => PaymentIntent + Customer + EphemeralKey (PaymentSheet)
  // 1) Create Customer
  const customerRes = await axios.post(
    `${STRIPE_API_BASE}/v1/customers`,
    formEncode({}),
    { headers: stripeHeaders(secretKey), timeout: 30000 }
  );
  const customer = customerRes?.data;

  // 2) Create Ephemeral Key for that customer
  const ephRes = await axios.post(
    `${STRIPE_API_BASE}/v1/ephemeral_keys`,
    formEncode({ customer: customer?.id }),
    {
      headers: stripeHeaders(secretKey, { "Stripe-Version": apiVersion }),
      timeout: 30000,
    }
  );
  const ephKey = ephRes?.data;

  // 3) Create PaymentIntent
  const piRes = await axios.post(
    `${STRIPE_API_BASE}/v1/payment_intents`,
    formEncode({
      amount: amountMinor,
      currency,
      customer: customer?.id,
      "metadata[reference]": reference,
      "metadata[product]": "TOWMECH_BOOKING_FEE",
      // You can add automatic_payment_methods if desired:
      // "automatic_payment_methods[enabled]": "true",
    }),
    { headers: stripeHeaders(secretKey), timeout: 30000 }
  );
  const paymentIntent = piRes?.data;

  return {
    provider: "stripe",
    method: "stripe",
    flowType: "SDK",
    reference,
    paymentIntentId: paymentIntent?.id || null,
    sdkParams: {
      publishableKey,
      customerId: customer?.id,
      ephemeralKeySecret: ephKey?.secret,
      paymentIntentClientSecret: paymentIntent?.client_secret,
    },
    raw: {
      customer,
      ephemeralKey: ephKey,
      paymentIntent,
    },
  };
}

export async function stripeVerifyPayment(payload = {}) {
  const { secretKey } = getKeys(payload);

  const paymentIntentId = String(payload.paymentIntentId || "").trim();
  if (!paymentIntentId) throw new Error("paymentIntentId is required");

  const res = await axios.get(`${STRIPE_API_BASE}/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    headers: stripeHeaders(secretKey),
    timeout: 30000,
  });

  const pi = res?.data;
  const status = String(pi?.status || "").toLowerCase();

  // succeeded | requires_payment_method | processing | canceled | etc.
  const paid = status === "succeeded";

  return {
    provider: "stripe",
    method: "stripe",
    paymentIntentId,
    status,
    paid,
    amount: pi?.amount ? Number(pi.amount) / 100 : null,
    currency: pi?.currency ? String(pi.currency).toUpperCase() : null,
    raw: pi,
  };
}