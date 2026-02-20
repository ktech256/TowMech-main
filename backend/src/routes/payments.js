// backend/src/routes/payments.js
import express from "express";
import crypto from "crypto";

import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import Job, { JOB_STATUSES } from "../models/Job.js";

import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import { broadcastJobToProviders } from "../utils/broadcastJob.js";
import {
  getGatewayAdapter,
  getActivePaymentGateway,
  normalizeGatewayKeyToEnum,
  resolvePaymentRoutingForCountry,
} from "../services/payments/index.js";

// ✅ ADD: Paystack verify helper
import { paystackVerifyPayment } from "../services/payments/providers/paystack.js";

const router = express.Router();

console.log("✅ payments.js loaded ✅");

/* ============================================================
   HELPERS
============================================================ */

function encodePayfast(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function buildSignatureFromRaw(rawBody, passphrase) {
  const pairs = (rawBody || "").split("&").filter(Boolean);
  const withoutSig = pairs.filter((p) => !p.startsWith("signature=")).join("&");

  const finalString =
    passphrase && passphrase.trim() !== ""
      ? `${withoutSig}&passphrase=${encodePayfast(passphrase.trim())}`
      : withoutSig;

  return md5(finalString).toLowerCase();
}

function buildSignatureSorted(body, passphrase) {
  const data = { ...(body || {}) };
  delete data.signature;

  const keys = Object.keys(data).sort();

  const queryString = keys
    .map((k) => {
      const v = data[k] ?? "";
      return `${k}=${encodePayfast(v)}`;
    })
    .join("&");

  const finalString =
    passphrase && passphrase.trim() !== ""
      ? `${queryString}&passphrase=${encodePayfast(passphrase.trim())}`
      : queryString;

  return md5(finalString).toLowerCase();
}

function normalizeFlowType(v) {
  const t = String(v || "REDIRECT").trim().toUpperCase();
  return t === "SDK" ? "SDK" : "REDIRECT";
}

/**
 * ✅ Strict unified PaymentInstruction builder (ALWAYS returned)
 */
function buildPaymentInstruction({
  flowType,
  gateway,
  countryCode,
  currency,
  amount,
  reference,
  redirectUrl = null,
  sdkParams = null,
}) {
  return {
    paymentFlowType: flowType, // "REDIRECT" | "SDK"
    gateway,
    countryCode,
    currency,
    amount,
    reference,
    redirectUrl,
    sdkParams,
    successSignal: "PAYMENT_SUCCESS",
    cancelSignal: "PAYMENT_CANCELLED",
    verifyAction: {
      type: "POLL",
      endpoint: `/api/payments/reference/${reference}/status`,
      method: "GET",
    },
  };
}

/**
 * ✅ ADD: shared "mark paid + update job + broadcast" helper
 */
async function markPaymentPaidAndBroadcast(payment, payload = null) {
  if (!payment) return null;

  if (payment.status !== PAYMENT_STATUSES.PAID) {
    payment.status = PAYMENT_STATUSES.PAID;
    payment.paidAt = new Date();

    // keep any previous payload; attach new
    if (payload) {
      payment.providerPayload = {
        ...(payment.providerPayload || {}),
        verified: payload,
      };
    }

    await payment.save();
  }

  const job = await Job.findById(payment.job);
  if (job) {
    if (!job.pricing) job.pricing = {};
    job.pricing.bookingFeeStatus = "PAID";
    job.pricing.bookingFeePaidAt = new Date();
    await job.save();

    await broadcastJobToProviders(job._id);
  }

  return payment;
}

/* ============================================================
   ✅ PAYSTACK WEBHOOK (auto-mark paid)
   POST /api/payments/webhook/paystack
   - verifies signature (best-effort)
   - verifies with Paystack API (source of truth)
   - marks PAID + broadcasts job
============================================================ */

// IMPORTANT: capture raw body for signature verify
router.post(
  "/webhook/paystack",
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf; // Buffer
    },
  }),
  async (req, res) => {
    try {
      const sig = String(req.headers["x-paystack-signature"] || "").trim();
      const secret = String(process.env.PAYSTACK_SECRET_KEY || "").trim();

      // 1) Signature verification (best effort)
      if (sig && secret && req.rawBody) {
        const hash = crypto.createHmac("sha512", secret).update(req.rawBody).digest("hex");
        if (hash !== sig) {
          console.log("❌ Paystack webhook signature mismatch");
          return res.status(401).send("Invalid signature");
        }
      } else {
        // Don't hard fail; we'll still verify via Paystack API.
        console.log("⚠️ Paystack signature not verified (missing secret/sig/rawBody)");
      }

      const event = req.body || {};
      const data = event.data || {};

      const reference = String(data.reference || "").trim();
      const eventType = String(event.event || "").trim();
      const paystackStatus = String(data.status || "").trim().toLowerCase();

      console.log("✅ PAYSTACK WEBHOOK RECEIVED ✅", {
        event: eventType,
        status: paystackStatus,
        reference,
      });

      if (!reference) return res.status(200).json({ received: true, note: "No reference" });

      // 2) Find local payment by reference
      const payment = await Payment.findOne({ providerReference: reference });
      if (!payment) {
        // don't retry; but log
        console.log("⚠️ Paystack webhook: payment not found for reference", reference);
        return res.status(200).json({ received: true, note: "Payment not found" });
      }

      // If already paid, ack
      if (payment.status === PAYMENT_STATUSES.PAID) {
        return res.status(200).json({ received: true, note: "Already paid" });
      }

      // 3) Verify with Paystack (source of truth)
      let verify;
      try {
        verify = await paystackVerifyPayment({ reference });
      } catch (e) {
        console.log("❌ Paystack verify failed inside webhook:", e?.message || e);

        // Store payload for later debugging
        payment.providerPayload = {
          ...(payment.providerPayload || {}),
          webhook: event,
          verifyError: e?.message || String(e),
        };
        await payment.save();

        // respond 200 to avoid endless retries
        return res.status(200).json({ received: true, note: "Verify failed" });
      }

      const verifiedStatus = String(verify?.data?.status || "").trim().toLowerCase();
      const ok = verifiedStatus === "success";

      if (ok) {
        await markPaymentPaidAndBroadcast(payment, verify);
      } else {
        // keep record for debugging (do not mark paid)
        payment.providerPayload = {
          ...(payment.providerPayload || {}),
          webhook: event,
          verified: verify,
        };
        await payment.save();
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.log("❌ Paystack webhook error:", err?.message || err);
      // Always 200 so Paystack doesn't keep retrying
      return res.status(200).json({ received: true, error: err.message });
    }
  }
);

/* ============================================================
   ✅ OPTIONAL: PAYSTACK VERIFY (manual fallback)
   GET /api/payments/verify/paystack/:reference
   - verifies with Paystack
   - marks PAID + broadcasts job
============================================================ */

router.get(
  "/verify/paystack/:reference",
  auth,
  authorizeRoles(USER_ROLES.CUSTOMER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const reference = String(req.params.reference || "").trim();
      if (!reference) return res.status(400).json({ success: false, message: "reference is required" });

      const payment = await Payment.findOne({ providerReference: reference });
      if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });

      // optional tenant/country guard
      const reqCountry = String(req.countryCode || "").trim().toUpperCase();
      if (
        reqCountry &&
        payment.countryCode &&
        reqCountry !== String(payment.countryCode).trim().toUpperCase()
      ) {
        return res.status(403).json({ success: false, message: "Country mismatch" });
      }

      const verify = await paystackVerifyPayment({ reference });
      const verifiedStatus = String(verify?.data?.status || "").trim().toLowerCase();
      const ok = verifiedStatus === "success";

      if (!ok) {
        payment.providerPayload = {
          ...(payment.providerPayload || {}),
          verified: verify,
        };
        await payment.save();

        return res.status(400).json({ success: false, message: "Payment not successful", verify });
      }

      await markPaymentPaidAndBroadcast(payment, verify);

      return res.status(200).json({
        success: true,
        message: "Payment verified + marked PAID ✅",
        reference,
        status: PAYMENT_STATUSES.PAID,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Failed to verify payment",
        error: err.message,
      });
    }
  }
);

/* ============================================================
   STATUS ENDPOINT (verifyAction target)
============================================================ */

router.get("/reference/:reference/status", auth, async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();
    if (!reference) return res.status(400).json({ message: "reference is required" });

    const payment = await Payment.findOne({ providerReference: reference });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    // optional tenant/country guard
    const reqCountry = String(req.countryCode || "").trim().toUpperCase();
    if (
      reqCountry &&
      payment.countryCode &&
      reqCountry !== String(payment.countryCode).trim().toUpperCase()
    ) {
      return res.status(403).json({ message: "Country mismatch" });
    }

    return res.status(200).json({
      success: true,
      reference,
      status: payment.status,
      paid: payment.status === PAYMENT_STATUSES.PAID,
      amount: payment.amount,
      currency: payment.currency,
      gateway: payment.provider,
      paidAt: payment.paidAt || null,
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load status", error: err.message });
  }
});

/* ============================================================
   PAYFAST ITN
============================================================ */

router.post(
  "/notify/payfast",
  express.urlencoded({
    extended: false,
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
  async (req, res) => {
    try {
      const data = req.body || {};
      const raw = req.rawBody || "";

      console.log("✅ PAYFAST ITN RECEIVED ✅", data);

      const reference = data.m_payment_id;
      const paymentStatus = (data.payment_status || "").toUpperCase();
      const receivedSignature = (data.signature || "").toLowerCase();

      if (!reference || !receivedSignature) {
        return res.status(200).send("Missing reference or signature");
      }

      const passphrase = (process.env.PAYFAST_PASSPHRASE || "").trim();

      // verify signature multiple ways (raw vs sorted, with pass vs no pass)
      const sigRawWithPass = buildSignatureFromRaw(raw, passphrase);
      const sigRawNoPass = buildSignatureFromRaw(raw, "");
      const sigSortedWithPass = buildSignatureSorted(data, passphrase);
      const sigSortedNoPass = buildSignatureSorted(data, "");

      const signatureMatches =
        receivedSignature === sigRawWithPass ||
        receivedSignature === sigRawNoPass ||
        receivedSignature === sigSortedWithPass ||
        receivedSignature === sigSortedNoPass;

      if (paymentStatus !== "COMPLETE") {
        console.log("⚠️ PayFast payment not COMPLETE:", paymentStatus);
        return res.status(200).send("Payment not complete");
      }

      const payment = await Payment.findOne({ providerReference: reference });
      if (!payment) return res.status(200).send("Payment not found");

      if (payment.status === PAYMENT_STATUSES.PAID) {
        return res.status(200).send("Already paid");
      }

      if (!signatureMatches) {
        console.log("❌ PAYFAST ITN SIGNATURE MISMATCH ❌");
        return res.status(200).send("Signature mismatch");
      }

      payment.status = PAYMENT_STATUSES.PAID;
      payment.paidAt = new Date();
      payment.providerPayload = data;
      await payment.save();

      const job = await Job.findById(payment.job);
      if (!job) return res.status(200).send("Job not found");

      if (!job.pricing) job.pricing = {};
      job.pricing.bookingFeeStatus = "PAID";
      job.pricing.bookingFeePaidAt = new Date();
      await job.save();

      await broadcastJobToProviders(job._id);

      return res.status(200).send("ITN Processed ✅");
    } catch (err) {
      console.error("❌ PAYFAST ITN ERROR:", err);
      return res.status(200).send("ITN error handled");
    }
  }
);

/* ============================================================
   CREATE PAYMENT
   - CountryServiceConfig routing decides gateway + flowType
   - ALWAYS returns: { instruction: PaymentInstruction }
============================================================ */

router.post(
  "/create",
  auth,
  authorizeRoles(USER_ROLES.CUSTOMER),
  async (req, res) => {
    console.log("✅ /api/payments/create HIT ✅", req.body);

    try {
      const { jobId } = req.body || {};
      if (!jobId) return res.status(400).json({ message: "jobId is required" });

      const job = await Job.findById(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });

      if (String(job.customer) !== String(req.user._id)) {
        return res.status(403).json({ message: "Not authorized to pay for this job" });
      }

      if ([JOB_STATUSES.CANCELLED, JOB_STATUSES.COMPLETED].includes(job.status)) {
        return res.status(400).json({ message: `Cannot pay for job in status ${job.status}` });
      }

      const bookingFee = Number(job.pricing?.bookingFee || 0);
      if (!Number.isFinite(bookingFee) || bookingFee <= 0) {
        return res.status(400).json({ message: "Booking fee not set" });
      }

      /* ======================
         COUNTRY ISOLATION
      ====================== */
      const reqCountry = String(req.countryCode || "ZA").trim().toUpperCase();
      const jobCountry = String(job.countryCode || reqCountry || "ZA").trim().toUpperCase();

      if (reqCountry && job.countryCode && reqCountry !== jobCountry) {
        return res.status(403).json({
          message: `Country mismatch. Job belongs to ${jobCountry}`,
          countryCode: reqCountry,
          jobCountryCode: jobCountry,
        });
      }

      /* ======================
         ROUTING
      ====================== */
      const routing = await resolvePaymentRoutingForCountry(jobCountry);

      // getActivePaymentGateway already returns enum, but normalize anyway
      const activeGatewayEnum = await getActivePaymentGateway(jobCountry);
      const gatewayEnum = normalizeGatewayKeyToEnum(activeGatewayEnum);

      const gatewayAdapter = await getGatewayAdapter(jobCountry);

      /* ======================
         PAYMENT RECORD
      ====================== */
      let payment = await Payment.findOne({
        job: job._id,
        countryCode: jobCountry,
      });

      if (payment && payment.status === PAYMENT_STATUSES.PAID) {
        const referencePaid = payment.providerReference || `TM-${payment._id}`;

        const instructionPaid = buildPaymentInstruction({
          flowType: "REDIRECT",
          gateway: payment.provider || gatewayEnum,
          countryCode: jobCountry,
          currency: payment.currency || job.pricing?.currency || "ZAR",
          amount: payment.amount || bookingFee,
          reference: referencePaid,
          redirectUrl: null,
          sdkParams: null,
        });

        return res.status(200).json({
          success: true,
          message: "Payment already PAID ✅",
          instruction: instructionPaid,
          payment,
        });
      }

      if (!payment) {
        payment = await Payment.create({
          job: job._id,
          customer: req.user._id,
          amount: bookingFee,
          currency: job.pricing?.currency || "ZAR",
          status: PAYMENT_STATUSES.PENDING,
          provider: gatewayEnum,
          countryCode: jobCountry,
        });
      } else {
        payment.provider = gatewayEnum;
        if (!payment.countryCode) payment.countryCode = jobCountry;
        await payment.save();
      }

      const reference = `TM-${payment._id}`;

      const frontendBase = String(process.env.FRONTEND_URL || "https://towmech.com").replace(/\/+$/, "");
      const backendBase = String(process.env.BACKEND_URL || "https://api.towmech.com").replace(/\/+$/, "");

      const successUrl = `${frontendBase}/payment-success`;
      const cancelUrl = `${frontendBase}/payment-cancel`;

      const notifyUrl =
        gatewayEnum === "PAYFAST" ? `${backendBase}/api/payments/notify/payfast` : null;

      /* ======================
         CALL ADAPTER
      ====================== */
      let initResponse;
      try {
        initResponse = await gatewayAdapter.createPayment({
          amount: bookingFee,
          currency: payment.currency,
          reference,
          successUrl,
          cancelUrl,
          notifyUrl,
          customerEmail: req.user.email,
          customerPhone: req.user.phoneNumber || req.user.phone || null,
          customerName: req.user.name || req.user.fullName || "TowMech User",
          countryCode: jobCountry,
          routing,
        });
      } catch (e) {
        console.error("❌ Adapter createPayment failed:", e?.message || e);
        return res.status(400).json({
          success: false,
          message: `Payment gateway (${gatewayEnum}) not configured or not supported.`,
          gateway: gatewayEnum,
          countryCode: jobCountry,
          error: e?.message || String(e),
        });
      }

      payment.providerReference = reference;
      payment.providerPayload = initResponse;
      await payment.save();

      /* ======================
         FLOW TYPE (from routing)
      ====================== */
      const providerDef = (routing.providers || []).find(
        (p) => String(p.gateway || "").toUpperCase() === String(gatewayEnum).toUpperCase()
      );

      const flowType = normalizeFlowType(providerDef?.flowType);

      const redirectUrl =
        initResponse?.redirectUrl ||
        initResponse?.paymentUrl ||
        initResponse?.authorizationUrl ||
        initResponse?.data?.redirectUrl ||
        initResponse?.data?.paymentUrl ||
        initResponse?.data?.authorizationUrl ||
        null;

      const sdkParams =
        flowType === "SDK"
          ? (initResponse?.sdkParams || initResponse?.data?.sdkParams || null)
          : null;

      const instruction = buildPaymentInstruction({
        flowType,
        gateway: gatewayEnum,
        countryCode: jobCountry,
        currency: payment.currency,
        amount: bookingFee,
        reference,
        redirectUrl: flowType === "REDIRECT" ? redirectUrl : null,
        sdkParams: flowType === "SDK" ? sdkParams : null,
      });

      return res.status(201).json({
        success: true,
        message: `${gatewayEnum} initialized ✅`,
        instruction,
        payment,
      });
    } catch (err) {
      console.error("❌ PAYMENT CREATE ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Could not create payment",
        error: err.message,
      });
    }
  }
);

export default router;