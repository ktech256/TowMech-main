// backend/src/services/payments/providers/adyen.js
import axios from "axios";

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function getProviderConfig(payload) {
  const routing = payload?.routing;
  const providers = Array.isArray(routing?.providers) ? routing.providers : [];
  const def = providers.find((p) => String(p?.gateway || "").toUpperCase() === "ADYEN");
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

function getEnv(payload) {
  const cfg = getProviderConfig(payload);
  return String(cfg.env || process.env.ADYEN_ENV || "test").toLowerCase(); // test | live
}

function getBaseUrl(payload) {
  const cfg = getProviderConfig(payload);

  if (cfg.baseUrl) return String(cfg.baseUrl).replace(/\/$/, "");

  // Checkout API base
  // test: https://checkout-test.adyen.com
  // live: https://checkout-live.adyen.com
  const env = getEnv(payload);
  return env === "live" ? "https://checkout-live.adyen.com" : "https://checkout-test.adyen.com";
}

function getKeys(payload) {
  const cfg = getProviderConfig(payload);

  const apiKey = pickFirst(cfg.apiKey, process.env.ADYEN_API_KEY);
  const merchantAccount = pickFirst(cfg.merchantAccount, process.env.ADYEN_MERCHANT_ACCOUNT);
  const clientKey = pickFirst(cfg.clientKey, process.env.ADYEN_CLIENT_KEY);

  requireValue("ADYEN_API_KEY", apiKey);
  requireValue("ADYEN_MERCHANT_ACCOUNT", merchantAccount);
  requireValue("ADYEN_CLIENT_KEY", clientKey);

  // Allow version override if your account expects a different API version
  const apiVersion = pickFirst(cfg.apiVersion, process.env.ADYEN_API_VERSION, "v71");

  return { apiKey, merchantAccount, clientKey, apiVersion };
}

function toMinorUnits(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid amount");
  // For simplicity: assume 2-decimal currencies; extend if needed
  return Math.round(n * 100);
}

export async function adyenCreatePayment(payload = {}) {
  const { apiKey, merchantAccount, clientKey, apiVersion } = getKeys(payload);
  const baseUrl = getBaseUrl(payload);

  const reference = String(payload.reference || "").trim();
  if (!reference) throw new Error("Adyen requires reference");

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

  const currency = String(payload.currency || "ZAR").trim().toUpperCase();
  const value = toMinorUnits(amount, currency);

  const successUrl = String(payload.successUrl || "").trim();
  const cancelUrl = String(payload.cancelUrl || "").trim();

  // Prefer a single returnUrl; if you have separate success/cancel on frontend,
  // use successUrl and your frontend can interpret resultCode in query string.
  const returnUrl = successUrl || cancelUrl;
  if (!returnUrl) throw new Error("Adyen requires successUrl or cancelUrl as returnUrl");

  // Decide flowType from routing (default: SDK sessions)
  const flowType =
    String(payload?.flowType || payload?.providerFlowType || "")
      .trim()
      .toUpperCase() === "REDIRECT"
      ? "REDIRECT"
      : "SDK";

  if (flowType === "REDIRECT") {
    // Payment Links API
    const endpoint = `${baseUrl}/${apiVersion}/paymentLinks`;

    const body = {
      reference,
      amount: { currency, value },
      merchantAccount,
      returnUrl,
    };

    const res = await axios.post(endpoint, body, {
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    const data = res?.data;

    return {
      provider: "adyen",
      method: "adyen",
      flowType: "REDIRECT",
      reference,
      paymentLinkId: data?.id || null,
      redirectUrl: data?.url || null,
      paymentUrl: data?.url || null,
      raw: data,
    };
  }

  // SDK flow: Sessions (Drop-in)
  const endpoint = `${baseUrl}/${apiVersion}/sessions`;

  const body = {
    merchantAccount,
    reference,
    amount: { currency, value },
    returnUrl,
    countryCode: payload.countryCode ? String(payload.countryCode).toUpperCase() : undefined,
  };

  const res = await axios.post(endpoint, body, {
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  const data = res?.data;

  return {
    provider: "adyen",
    method: "adyen",
    flowType: "SDK",
    reference,
    sdkParams: {
      environment: getEnv(payload),
      clientKey,
      sessionId: data?.id,
      sessionData: data?.sessionData,
    },
    raw: data,
  };
}

export async function adyenVerifyPayment(payload = {}) {
  // Adyen verification is typically via webhook (AUTHORISATION) + pspReference,
  // or querying Payments API with pspReference (depends on your integration).
  // Stub for now so your adapter can call something predictable.
  const pspReference = String(payload.pspReference || "").trim();
  if (!pspReference) throw new Error("pspReference is required for adyenVerifyPayment");

  return {
    provider: "adyen",
    method: "adyen",
    pspReference,
    status: "unknown",
    paid: false,
    raw: null,
  };
}