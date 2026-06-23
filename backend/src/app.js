// backend/src/app.js

import express from "express";
import cors from "cors";

// ✅ Routes
import authRoutes from "./routes/auth.js";
import jobRoutes from "./routes/jobs.js";
import providerRoutes from "./routes/providers.js";
import paymentRoutes from "./routes/payments.js";
import payoutRoutes from "./routes/payouts.js"; // ✅ NEW
import notificationRoutes from "./routes/notifications.js";

// ✅ SAFETY ROUTES
import safetyRoutes from "./routes/safety.js";
import adminSafetyRoutes from "./routes/adminSafety.js";

// ✅ Config Routes
import configRoutes from "./routes/config.js";

// ✅ Admin Routes
import pricingConfigRoutes from "./routes/adminPricing.js";
import adminProviderRoutes from "./routes/adminProviders.js";
import adminStatisticsRoutes from "./routes/adminStatistics.js";
import adminJobsRoutes from "./routes/adminJobs.js";
import adminLiveMapRoutes from "./routes/adminLiveMap.js";
import adminPaymentsRoutes from "./routes/adminPayments.js";
import adminAnalyticsRoutes from "./routes/adminAnalytics.js";
import adminSettingsRoutes from "./routes/adminSettings.js";
import adminZonesRoutes from "./routes/adminZones.js";
import adminOverviewRoutes from "./routes/adminOverview.js";

// ✅ SuperAdmin + Admin User Management
import superAdminRoutes from "./routes/superAdmin.js";
import adminUsersRoutes from "./routes/adminUsers.js";

// ✅ Support Routes
import supportRoutes from "./routes/support.js";
import adminSupportRoutes from "./routes/adminSupport.js";

// ✅ Notifications Routes
import adminNotificationsRoutes from "./routes/adminNotifications.js";

// ✅ ✅ ✅ RATINGS ROUTES
import ratingRoutes from "./routes/rating.routes.js";

// ✅ ✅ ✅ CHAT ROUTES
import chatRoutes from "./routes/chat.routes.js";
import adminChatRoutes from "./routes/adminChat.routes.js";

// ✅ NEW: Multi-country / tenant middleware
import tenant from "./middleware/tenant.js";

// ✅ NEW: i18n middleware (adds req.lang + req.t())
import i18n from "./middleware/i18n.js";

// ✅ Existing public routes
import legalRoutes from "./routes/legal.routes.js";
import insuranceRoutes from "./routes/insurance.routes.js";
import countryRoutes from "./routes/country.routes.js";
import providerDocRoutes from "./routes/providerDocuments.js";

// ✅ ✅ ✅ MISSING DASHBOARD ROUTES (NEW)
import adminCountriesRoutes from "./routes/adminCountries.routes.js";
import adminCountryServicesRoutes from "./routes/adminCountryServices.routes.js";
import adminPaymentRoutingRoutes from "./routes/adminPaymentRouting.routes.js";
import adminLegalRoutes from "./routes/adminLegal.routes.js";
import adminInsuranceRoutes from "./routes/adminInsurance.routes.js";
import adminServiceCategoriesRoutes from "./routes/adminServiceCategories.js";

// ✅ NEW: Partner Ecosystem (Phase 10)
import adminPartnersRoutes from "./routes/adminPartners.js";
import partnerAuthRoutes from "./routes/partnerAuth.js";
import fleetPortalRoutes from "./routes/fleetPortal.js";
import insurancePortalRoutes from "./routes/insurancePortal.js";
import adminPortalControlRoutes from "./routes/adminPortalControl.js";
import systemRoutes from "./routes/system.js";

// ✅ Verification Auditor (Phase 7)
import { runVerificationAudit } from "./utils/verificationAuditor.js";

const app = express();

// ✅ Required for Render load balancer to pass through HTTPS and IP
app.set("trust proxy", 1);

/**
 * ✅ Middleware
 * CORS allowlist
 */
const allowedOrigins = [
  "https://towmech-admin-dashboard-jgqn.onrender.com",
  "https://towmech-website-staging.onrender.com",
  "https://admin-staging.towmech.com",
  "https://admin.towmech.com",
  "https://staging.towmech.com",
  "https://towmech.com",
  "https://www.towmech.com",
  "https://fleet.towmech.com",
  "https://insurance.towmech.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // For development, allow any origin if requested
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }

      console.warn(`⚠️ CORS Blocked for origin: ${origin}`);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-COUNTRY-CODE",
      "x-country-code",
      "X-Requested-With",

      // ✅ language headers
      "X-LANGUAGE",
      "x-language",
      "Accept-Language",
      "accept-language",
    ],
  })
);

app.options("*", cors());

/**
 * ✅ RAW BODY CAPTURE
 */
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

/**
 * ✅ Tenant middleware
 */
app.use(tenant);

/**
 * ✅ i18n middleware (after tenant, before routes)
 * Adds:
 * - req.lang   (e.g. "en", "sw", "pt")
 * - req.t(key, vars)  translator
 */
app.use(i18n);

/**
 * ✅ Health Check
 */
app.get("/health", (req, res) => {
  return res.status(200).json({
    status: "ok ✅",
    countryCode: req.countryCode || "ZA",
    lang: req.lang || "en",
  });
});

/**
 * ✅ PUBLIC ROUTES
 */
app.use("/api/auth", authRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/providers", providerDocRoutes); // ✅ Granular Doc Routes (Phase 6)
app.use("/api/providers", providerRoutes);
app.use("/api/payouts", payoutRoutes); // ✅ NEW
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);

/**
 * ✅ COUNTRIES (PUBLIC)
 */
app.use("/api/countries", countryRoutes);

/**
 * ✅ CONFIG
 */
app.use("/api/config", configRoutes);

/**
 * ✅ LEGAL (PUBLIC)
 */
app.use("/api/legal", legalRoutes);

/**
 * ✅ INSURANCE (PUBLIC)
 */
app.use("/api/insurance", insuranceRoutes);

/**
 * ✅ RATINGS
 */
app.use("/api/jobs", ratingRoutes);
app.use("/api/admin", ratingRoutes);

/**
 * ✅ CHAT
 */
app.use("/api/chat", chatRoutes);
app.use("/api/admin/chats", adminChatRoutes);

/**
 * ✅ SAFETY
 */
app.use("/api/safety", safetyRoutes);

/**
 * ✅ Pricing Config
 */
app.use("/api/pricing-config", pricingConfigRoutes);

/**
 * ✅ SUPPORT
 */
app.use("/api/support", supportRoutes);

/**
 * ✅ SYSTEM DIAGNOSTICS
 */
app.use("/api/system", systemRoutes);

/**
 * ✅ ADMIN ROUTES (EXISTING)
 */
app.use("/api/admin/providers", adminProviderRoutes);
app.use("/api/admin/statistics", adminStatisticsRoutes);
app.use("/api/admin/jobs", adminJobsRoutes);
app.use("/api/admin/live", adminLiveMapRoutes);
app.use("/api/admin/payments", adminPaymentsRoutes);
app.use("/api/admin/analytics", adminAnalyticsRoutes);
app.use("/api/admin/support", adminSupportRoutes);
app.use("/api/admin/notifications", adminNotificationsRoutes);
app.use("/api/admin/settings", adminSettingsRoutes);
app.use("/api/admin/zones", adminZonesRoutes);
app.use("/api/admin/overview", adminOverviewRoutes);
app.use("/api/admin/safety", adminSafetyRoutes);
app.use("/api/admin", adminUsersRoutes);
app.use("/api/superadmin", superAdminRoutes);

/**
 * ✅ PARTNER ECOSYSTEM (Phase 10)
 */
app.use("/api/admin/partners", adminPartnersRoutes);
app.use("/api/partner-auth", partnerAuthRoutes);
app.use("/api/fleet-portal", fleetPortalRoutes);
app.use("/api/insurance-portal", insurancePortalRoutes);
app.use("/api/admin/portal-control", adminPortalControlRoutes);

/**
 * ✅ ✅ ✅ ADMIN ROUTES REQUIRED BY DASHBOARD (NEW)
 */
app.use("/api/admin/countries", adminCountriesRoutes);
app.use("/api/admin/country-services", adminCountryServicesRoutes);
app.use("/api/admin/payment-routing", adminPaymentRoutingRoutes);
app.use("/api/admin/legal", adminLegalRoutes);

// ✅ ✅ ✅ THIS IS THE ONLY “MOUNT” YOU NEED FOR INVOICE + PDF
app.use("/api/admin/insurance", adminInsuranceRoutes);

app.use("/api/admin/service-categories", adminServiceCategoriesRoutes);

/**
 * ✅ Phase 7: Daily Verification Audit
 */
setInterval(() => {
  runVerificationAudit().catch(err => console.error("❌ Auditor Error:", err));
}, 24 * 60 * 60 * 1000); // Once every 24 hours

// Trigger once on boot (optional, but helps verification)
runVerificationAudit().catch(err => console.error("❌ Auditor Boot Error:", err));

/**
 * ✅ 404 Handler
 */
app.use((req, res) => {
  const t = typeof req.t === "function" ? req.t : (k) => k;
  return res.status(404).json({
    message: t("errors.route_not_found", { fallback: "Route not found ❌" }),
    method: req.method,
    path: req.originalUrl,
  });
});

/**
 * ✅ Global Error Handler
 */
app.use((err, req, res, next) => {
  console.error("🔥 INTERNAL ERROR:", err);

  return res.status(err.statusCode || 500).json({
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

export default app;