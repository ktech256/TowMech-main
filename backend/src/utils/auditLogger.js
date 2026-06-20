// backend/src/utils/auditLogger.js
import FinancialLog from "../models/FinancialLog.js";

/**
 * ✅ Centralized Audit Logger
 */
export async function logAuditEvent(req, { action, entityType, entityId, details }) {
  try {
    const countryCode =
      req.countryCode ||
      req.headers["x-country-code"] ||
      req.body?.countryCode ||
      "ZA";

    await FinancialLog.create({
      action,
      entityType,
      entityId,
      countryCode: String(countryCode).toUpperCase(),
      performedBy: req.user?._id || req.user?.id,
      details,
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });
  } catch (err) {
    console.error("❌ Audit Logging Failed:", err.message);
  }
}
