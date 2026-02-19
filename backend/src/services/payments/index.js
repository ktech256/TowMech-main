// backend/src/services/payments/index.js
import CountryServiceConfig from "../../models/CountryServiceConfig.js";

// ✅ Existing gateway adapters
import ikhokaGateway from "./ikhokha.js";
import payfastGateway from "./payfast.js";
import peachGateway from "./peachPayments.js";

// ✅ Providers folder modules (existing)
import { paystackCreatePayment, paystackVerifyPayment } from "./providers/paystack.js";
import { flutterwaveCreatePayment, flutterwaveVerifyPayment } from "./providers/flutterwave.js";
import { mpesaCreatePayment, mpesaVerifyPayment } from "./providers/mpesa.js";

// ✅ NEW providers (Phase 2)
import { stripeCreatePayment, stripeVerifyPayment } from "./providers/stripe.js";
import { paypalCreatePayment, paypalVerifyPayment } from "./providers/paypal.js";
import { adyenCreatePayment, adyenVerifyPayment } from "./providers/adyen.js";

/**
 * Normalize a provider key from dashboard into a stable gateway enum.
 */
export function normalizeGatewayKeyToEnum(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return "IKHOKHA";

  if (k === "payfast") return "PAYFAST";
  if (k === "ikhokha" || k === "i-khokha" || k === "i_khokha") return "IKHOKHA";
  if (k === "paystack") return "PAYSTACK";
  if (k === "stripe") return "STRIPE";
  if (k === "mpesa" || k === "m-pesa" || k === "m_pesa") return "MPESA";
  if (k === "flutterwave") return "FLUTTERWAVE";
  if (k === "mtn_momo" || k === "mtn" || k === "mtn_mobile_money") return "MTN_MOMO";
  if (k === "adyen") return "ADYEN";
  if (k === "paypal") return "PAYPAL";
  if (k === "google_pay" || k === "googlepay") return "GOOGLE_PAY";
  if (k === "apple_pay" || k === "applepay") return "APPLE_PAY";

  if (k === "peach" || k === "peachpayments" || k === "peach_payments") return "PEACH_PAYMENTS";

  return k.toUpperCase();
}

function normalizeFlowType(v) {
  const t = String(v || "REDIRECT").trim().toUpperCase();
  return t === "SDK" ? "SDK" : "REDIRECT";
}

function normalizeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function normalizePriority(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize providers source:
 * - NEW: payments.providers[] = [{gateway, flowType, enabled, priority, sdkConfig, redirectConfig, config}]
 * - LEGACY: payments.providers = { payfast:{enabled,...}, paystack:{enabled,...} }
 */
function normalizeProviders(payments = {}) {
  const providers = payments?.providers;

  if (Array.isArray(providers)) {
    return providers
      .filter(Boolean)
      .map((p) => ({
        gateway: normalizeGatewayKeyToEnum(p.gateway),
        flowType: normalizeFlowType(p.flowType),
        enabled: !!p.enabled,
        priority: normalizePriority(p.priority),

        sdkConfig: normalizeObj(p.sdkConfig),
        redirectConfig: normalizeObj(p.redirectConfig),

        // back-compat
        config: normalizeObj(p.config),
      }))
      .filter((p) => !!p.gateway);
  }

  if (providers && typeof providers === "object") {
    return Object.entries(providers)
      .map(([key, val]) => ({
        gateway: normalizeGatewayKeyToEnum(key),
        flowType: normalizeFlowType(val?.flowType),
        enabled: !!val?.enabled,
        priority: normalizePriority(val?.priority),

        // legacy only had "config"
        config: normalizeObj(val?.config),

        // phase 2 keys may exist but not guaranteed
        sdkConfig: normalizeObj(val?.sdkConfig),
        redirectConfig: normalizeObj(val?.redirectConfig),
      }))
      .filter((p) => !!p.gateway);
  }

  return [];
}

/**
 * Resolve routing doc per country (creates if missing).
 */
export async function resolvePaymentRoutingForCountry(countryCode) {
  const cc = String(countryCode || process.env.DEFAULT_COUNTRY || "ZA")
    .trim()
    .toUpperCase();

  let cfg = await CountryServiceConfig.findOne({ countryCode: cc });

  if (!cfg) {
    cfg = await CountryServiceConfig.create({
      countryCode: cc,
      services: {},
      payments: {
        defaultProvider: "paystack",
        providers: [
          { gateway: "PAYSTACK", flowType: "REDIRECT", enabled: true, priority: 100, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "IKHOKHA", flowType: "REDIRECT", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "PAYFAST", flowType: "REDIRECT", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "FLUTTERWAVE", flowType: "REDIRECT", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "MPESA", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "PEACH_PAYMENTS", flowType: "REDIRECT", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },

          // Phase 2 SDK gateways
          { gateway: "STRIPE", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "PAYPAL", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "GOOGLE_PAY", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "APPLE_PAY", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
          { gateway: "ADYEN", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
        ],
      },
    });
  }

  const payments = cfg.payments || {};
  const defaultProviderKey = payments.defaultProvider || "paystack";
  const defaultProvider = normalizeGatewayKeyToEnum(defaultProviderKey);
  const providers = normalizeProviders(payments);

  return {
    countryCode: cc,
    defaultProviderKey: String(defaultProviderKey),
    defaultProvider,
    providers,
    raw: cfg,
  };
}

/**
 * ✅ Pick active provider based on:
 * 1) default provider if enabled
 * 2) else highest priority enabled
 * 3) else first enabled
 * 4) else default enum
 */
export async function getActivePaymentGateway(countryCode) {
  const routing = await resolvePaymentRoutingForCountry(countryCode);
  const list = Array.isArray(routing.providers) ? routing.providers : [];

  if (list.length > 0) {
    const def = list.find((p) => p.gateway === routing.defaultProvider);
    if (def && def.enabled) return def.gateway;

    const enabled = list.filter((p) => !!p.enabled);
    if (enabled.length > 0) {
      const sorted = [...enabled].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
      return sorted[0].gateway;
    }
  }

  return routing.defaultProvider;
}

/**
 * ✅ Find provider routing definition (config + flowType) by enum
 */
export async function getProviderDefForCountry(countryCode, gatewayEnum) {
  const routing = await resolvePaymentRoutingForCountry(countryCode);
  const wanted = String(gatewayEnum || "").toUpperCase();

  const def =
    (routing.providers || []).find((p) => String(p.gateway || "").toUpperCase() === wanted) || null;

  return { routing, def };
}

/**
 * Wallet alias resolution:
 * GOOGLE_PAY / APPLE_PAY are usually enabled THROUGH Stripe or Adyen.
 * Default: Stripe first, else Adyen.
 */
function resolveWalletAliasTarget({ routing, walletEnum }) {
  const prefer = String(process.env.WALLET_ALIAS_PROVIDER || "STRIPE").toUpperCase(); // STRIPE | ADYEN
  const enabledSet = new Set(
    (routing?.providers || []).filter((p) => p?.enabled).map((p) => String(p.gateway || "").toUpperCase())
  );

  if (prefer === "ADYEN") {
    if (enabledSet.has("ADYEN")) return "ADYEN";
    if (enabledSet.has("STRIPE")) return "STRIPE";
  } else {
    if (enabledSet.has("STRIPE")) return "STRIPE";
    if (enabledSet.has("ADYEN")) return "ADYEN";
  }

  // Even if not enabled explicitly, allow fallback to STRIPE then ADYEN if configured via env
  return prefer === "ADYEN" ? "ADYEN" : "STRIPE";
}

/**
 * ✅ Map gateway enum -> adapter implementation
 * Adapter must return:
 *   { gateway, reference, redirectUrl?, paymentUrl?, sdkParams?, initResponse? }
 */
function getLocalAdapterForGatewayEnum(gatewayEnum) {
  switch (String(gatewayEnum || "").toUpperCase()) {
    case "PAYFAST":
      return payfastGateway;

    case "PEACH_PAYMENTS":
      return peachGateway;

    case "IKHOKHA":
      return ikhokaGateway;

    case "PAYSTACK":
      return {
        provider: "PAYSTACK",
        createPayment: async ({ amount, currency, reference, successUrl, customerEmail }) => {
          const init = await paystackCreatePayment({
            amount,
            currency,
            email: customerEmail,
            reference,
            callbackUrl: successUrl || undefined,
          });

          const redirectUrl = init?.authorizationUrl || init?.redirectUrl || null;

          return {
            gateway: "PAYSTACK",
            reference: init.reference || reference,
            redirectUrl,
            paymentUrl: redirectUrl,
            initResponse: init.raw || init,
          };
        },
        verifyPayment: async ({ reference }) => paystackVerifyPayment({ reference }),
      };

    case "FLUTTERWAVE":
      return {
        provider: "FLUTTERWAVE",
        createPayment: async ({
          amount,
          currency,
          reference,
          successUrl,
          customerEmail,
          customerPhone,
          customerName,
        }) => {
          const init = await flutterwaveCreatePayment({
            amount,
            currency,
            email: customerEmail,
            phone: customerPhone,
            name: customerName,
            tx_ref: reference,
            redirect_url: successUrl,
          });

          const redirectUrl = init?.link || init?.redirectUrl || null;

          return {
            gateway: "FLUTTERWAVE",
            reference: init.tx_ref || reference,
            redirectUrl,
            paymentUrl: redirectUrl,
            initResponse: init.raw || init,
          };
        },
        verifyPayment: async ({ transactionId, tx_ref }) =>
          flutterwaveVerifyPayment({ transactionId, tx_ref }),
      };

    case "MPESA":
      return {
        provider: "MPESA",
        createPayment: async ({ amount, reference, customerPhone }) => {
          const init = await mpesaCreatePayment({
            amount,
            phone: customerPhone,
            reference,
            description: "TowMech Booking Fee",
          });

          return {
            gateway: "MPESA",
            reference: init.reference || reference,
            sdkParams: {
              checkoutRequestId: init.checkoutRequestId,
              merchantRequestId: init.merchantRequestId,
            },
            initResponse: init.raw || init,
          };
        },
        verifyPayment: async ({ checkoutRequestId }) =>
          mpesaVerifyPayment({ checkoutRequestId }),
      };

    // ✅ STRIPE (SDK + redirect)
    case "STRIPE":
      return {
        provider: "STRIPE",
        createPayment: async ({
          amount,
          currency,
          reference,
          successUrl,
          cancelUrl,
          customerEmail,
          countryCode,
          routing,
        }) => {
          const def =
            (routing?.providers || []).find((p) => String(p.gateway || "").toUpperCase() === "STRIPE") || null;

          const flowType = normalizeFlowType(def?.flowType);
          const sdkConfig = normalizeObj(def?.sdkConfig);
          const redirectConfig = normalizeObj(def?.redirectConfig);
          const legacyConfig = normalizeObj(def?.config);

          const init = await stripeCreatePayment({
            amount,
            currency,
            reference,
            successUrl,
            cancelUrl,
            customerEmail,
            countryCode,
            flowType,
            sdkConfig,
            redirectConfig,
            config: legacyConfig,
          });

          return {
            gateway: "STRIPE",
            reference,
            redirectUrl: init.redirectUrl || null,
            paymentUrl: init.redirectUrl || null,
            sdkParams: init.sdkParams || null,
            initResponse: init.raw || init,
          };
        },
        verifyPayment: async (payload) => stripeVerifyPayment(payload),
      };

    // ✅ PAYPAL (redirect + capture/verify path; SDK returns sdkParams)
    case "PAYPAL":
      return {
        provider: "PAYPAL",
        createPayment: async ({
          amount,
          currency,
          reference,
          successUrl,
          cancelUrl,
          countryCode,
          routing,
        }) => {
          const def =
            (routing?.providers || []).find((p) => String(p.gateway || "").toUpperCase() === "PAYPAL") || null;

          const flowType = normalizeFlowType(def?.flowType);
          const sdkConfig = normalizeObj(def?.sdkConfig);
          const redirectConfig = normalizeObj(def?.redirectConfig);
          const legacyConfig = normalizeObj(def?.config);

          const init = await paypalCreatePayment({
            amount,
            currency,
            reference,
            successUrl,
            cancelUrl,
            countryCode,
            flowType,
            sdkConfig,
            redirectConfig,
            config: legacyConfig,
          });

          return {
            gateway: "PAYPAL",
            reference,
            redirectUrl: init.redirectUrl || null,
            paymentUrl: init.redirectUrl || null,
            sdkParams: init.sdkParams || null,
            initResponse: init.raw || init,
          };
        },
        verifyPayment: async (payload) => paypalVerifyPayment(payload),
      };

    // ✅ ADYEN (SDK sessions + optional payment links)
    case "ADYEN":
      return {
        provider: "ADYEN",
        createPayment: async ({
          amount,
          currency,
          reference,
          successUrl,
          cancelUrl,
          countryCode,
          routing,
        }) => {
          const def =
            (routing?.providers || []).find((p) => String(p.gateway || "").toUpperCase() === "ADYEN") || null;

          const flowType = normalizeFlowType(def?.flowType);
          const sdkConfig = normalizeObj(def?.sdkConfig);
          const redirectConfig = normalizeObj(def?.redirectConfig);
          const legacyConfig = normalizeObj(def?.config);

          const init = await adyenCreatePayment({
            amount,
            currency,
            reference,
            successUrl,
            cancelUrl,
            countryCode,
            flowType,
            sdkConfig,
            redirectConfig,
            config: legacyConfig,
          });

          return {
            gateway: "ADYEN",
            reference,
            redirectUrl: init.redirectUrl || null,
            paymentUrl: init.redirectUrl || null,
            sdkParams: init.sdkParams || null,
            initResponse: init.raw || init,
          };
        },
        verifyPayment: async (payload) => adyenVerifyPayment(payload),
      };

    // ✅ Wallet aliases (route to Stripe/Adyen)
    case "GOOGLE_PAY":
    case "APPLE_PAY":
      return {
        provider: String(gatewayEnum || "").toUpperCase(),
        createPayment: async (payload) => {
          const routing = payload?.routing || null;
          const target = resolveWalletAliasTarget({ routing, walletEnum: gatewayEnum });

          if (target === "ADYEN") {
            const adyen = getLocalAdapterForGatewayEnum("ADYEN");
            if (!adyen) throw new Error("Adyen adapter not available");
            const init = await adyen.createPayment({
              ...payload,
              // for wallets, force SDK (Adyen Drop-in)
              routing: routing,
            });
            return {
              ...init,
              gateway: String(gatewayEnum || "").toUpperCase(), // keep the selected gateway in response
            };
          }

          // default -> Stripe
          const stripe = getLocalAdapterForGatewayEnum("STRIPE");
          if (!stripe) throw new Error("Stripe adapter not available");
          const init = await stripe.createPayment({
            ...payload,
            // Stripe PaymentSheet wallets are client-side; backend just creates PI
            routing: routing,
          });
          return {
            ...init,
            gateway: String(gatewayEnum || "").toUpperCase(),
          };
        },
        verifyPayment: async (payload) => {
          // Wallet verify is same as underlying gateway verify; default Stripe verify
          return stripeVerifyPayment(payload);
        },
      };

    default:
      return null;
  }
}

/**
 * ✅ Return gateway adapter for country’s chosen gateway
 * Throws clean error if adapter isn't implemented.
 */
export async function getGatewayAdapter(countryCode) {
  const activeGatewayEnum = await getActivePaymentGateway(countryCode);

  const adapter = getLocalAdapterForGatewayEnum(activeGatewayEnum);
  if (adapter) return adapter;

  const err = new Error(`Gateway adapter not implemented: ${activeGatewayEnum}`);
  err.code = "GATEWAY_NOT_IMPLEMENTED";
  throw err;
}