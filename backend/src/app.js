import express from "express";
import cors from "cors";

// ✅ Routes
import authRoutes from "./routes/auth.js";
import jobRoutes from "./routes/jobs.js";
import providerRoutes from "./routes/providers.js";
import paymentRoutes from "./routes/payments.js";
import notificationRoutes from "./routes/notifications.js";
import providerDocumentsRoutes from "./routes/providerDocuments.js";

// ✅ NEW ✅ Config Routes
import configRoutes from "./routes/config.js";

// ✅ Admin + Config Routes
import pricingConfigRoutes from "./routes/adminPricing.js";
import adminProviderRoutes from "./routes/adminProviders.js";
import adminStatisticsRoutes from "./routes/adminStatistics.js";
import adminJobsRoutes from "./routes/adminJobs.js";
import adminLiveMapRoutes from "./routes/adminLiveMap.js";
import adminPaymentsRoutes from "./routes/adminPayments.js";

// ✅ ✅ ✅ ANALYTICS ROUTE (NEW)
import adminAnalyticsRoutes from "./routes/adminAnalytics.js";

// ✅ NEW ROUTES (SuperAdmin + Admin User Management)
import superAdminRoutes from "./routes/superAdmin.js";
import adminUsersRoutes from "./routes/adminUsers.js";

// ✅ ✅ ✅ SUPPORT ROUTES
import supportRoutes from "./routes/support.js";
import adminSupportRoutes from "./routes/adminSupport.js";

// ✅ ✅ ✅ NOTIFICATIONS ROUTES (NEW ADMIN BROADCAST + LOGS)
import adminNotificationsRoutes from "./routes/adminNotifications.js";

const app = express();

/**
 * ✅ Middleware
 */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * ✅ Health Check
 */
app.get("/health", (req, res) => {
  return res.status(200).json({ status: "ok ✅" });
});

/**
 * ✅ PUBLIC ROUTES
 */
app.use("/api/auth", authRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/providers", providerDocumentsRoutes);

// ✅ ✅ ✅ CONFIG ROUTE (Vehicle Types + TowTruck Types + Pricing)
app.use("/api/config", configRoutes);

/**
 * ✅ Pricing Config Route
 * /api/pricing-config
 */
app.use("/api/pricing-config", pricingConfigRoutes);

/**
 * ✅ SUPPORT ROUTES
 */
app.use("/api/support", supportRoutes);

/**
 * ✅ ADMIN ROUTES
 */
app.use("/api/admin/providers", adminProviderRoutes);
app.use("/api/admin/statistics", adminStatisticsRoutes);
app.use("/api/admin/jobs", adminJobsRoutes);
app.use("/api/admin/live", adminLiveMapRoutes);
app.use("/api/admin/payments", adminPaymentsRoutes);

// ✅ ✅ ✅ ADMIN ANALYTICS ROUTE (NEW)
app.use("/api/admin/analytics", adminAnalyticsRoutes);

// ✅ ✅ ✅ ADMIN SUPPORT ROUTES
app.use("/api/admin/support", adminSupportRoutes);

// ✅ ✅ ✅ ADMIN NOTIFICATIONS ROUTES (Broadcast + Logs)
app.use("/api/admin/notifications", adminNotificationsRoutes);

// ✅ Admin User Management
app.use("/api/admin", adminUsersRoutes);

/**
 * ✅ SUPER ADMIN ROUTES
 */
app.use("/api/superadmin", superAdminRoutes);

/**
 * ✅ 404 Handler
 */
app.use((req, res) => {
  return res.status(404).json({
    message: "Route not found ❌",
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
