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
} from "../services/payments/index.js";

const router = express.Router();

console.log("✅ payments.js loaded ✅");

/**
 * PayFast encoding rules for signature:
 * - URL encode values
 * - Spaces must be "+"
 */
function encodePayfast(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

/**
 * ✅ Parse RAW x-www-form-urlencoded into encoded key/value pairs.
 * IMPORTANT: We keep the value exactly as received (already encoded),
 * and DO NOT decode/re-encode it (avoids normalization mismatches).
 */
function parseRawFormEncoded(raw = "") {
  const pairs = {};

  raw
    .split("&")
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf("=");
      const key = idx >= 0 ? part.slice(0, idx) : part;
      const val = idx >= 0 ? part.slice(idx + 1) : ""; // keep encoded value as-is
      pairs[key] = val;
    });

  return pairs;
}

/**
 * ✅ Generate PayFast ITN signature (correct approach)
 * - Use all fields except "signature"
 * - Sort keys alphabetically
 * - Use encoded values as received
 * - Append passphrase (encoded) if present
 * - MD5 hash
 */
function generatePayfastItnSignatureFromRaw(rawBody, passphrase = "") {
  const pairs = parseRawFormEncoded(rawBody || "");

  // remove signature if present
  delete pairs.signature;

  const keys = Object.keys(pairs).sort();

  const paramString = keys.map((k) => `${k}=${pairs[k] ?? ""}`).join("&");

  const finalString =
    passphrase && passphrase.trim() !== ""
      ? `${paramString}&passphrase=${encodePayfast(passphrase.trim())}`
      : paramString;

  return crypto.createHash("md5").update(finalString).digest("hex").toLowerCase();
}

/**
 * ✅ PayFast ITN Webhook
 * POST /api/payments/notify/payfast
 *
 * NOTE:
 * - app.js should capture req.rawBody using express.urlencoded verify hook (you already did)
 * - Always return 200 so PayFast doesn't retry forever
 */
router.post("/notify/payfast", async (req, res) => {
  try {
    console.log("✅ PAYFAST ITN RECEIVED ✅", req.body);

    const data = req.body || {};
    const reference = data.m_payment_id; // TM-<paymentId>
    const paymentStatus = (data.payment_status || "").toUpperCase();

    const raw = (req.rawBody || "").trim();
    console.log("✅ ITN RAW BODY:", raw);

    if (!reference) {
      console.log("❌ ITN missing m_payment_id");
      return res.status(200).send("Missing reference");
    }

    // ✅ get signature from parsed body (best) OR raw fallback
    const receivedSignatureFromBody = (data.signature || "").toLowerCase();
    const receivedSignatureFromRaw =
      (raw.match(/(?:^|&)signature=([^&]+)/)?.[1] || "").toLowerCase();

    const receivedSignature = receivedSignatureFromBody || receivedSignatureFromRaw;

    if (!receivedSignature) {
      console.log("❌ ITN missing signature");
      return res.status(200).send("Missing signature");
    }

    // ✅ Passphrase must match PayFast dashboard exactly
    const passphrase = (process.env.PAYFAST_PASSPHRASE || "").trim();

    // ✅ Correct signature generation (sorted keys, encoded values)
    const generatedSignature = generatePayfastItnSignatureFromRaw(raw, passphrase);

    console.log("✅ ITN generatedSignature:", generatedSignature);
    console.log("✅ ITN receivedSignature :", receivedSignature);

    if (generatedSignature !== receivedSignature) {
      console.log("❌ PAYFAST ITN SIGNATURE MISMATCH ❌");
      return res.status(200).send("Signature mismatch");
    }

    console.log("✅ PAYFAST ITN SIGNATURE VERIFIED ✅");

    // ✅ Only mark PAID if payment COMPLETE
    if (paymentStatus !== "COMPLETE") {
      console.log("⚠️ PayFast payment not COMPLETE:", paymentStatus);
      return res.status(200).send("Payment not complete");
    }

    // ✅ Find payment in DB (providerReference = TM-<paymentId>)
    const payment = await Payment.findOne({ providerReference: reference });

    if (!payment) {
      console.log("❌ Payment not found for providerReference:", reference);
      return res.status(200).send("Payment not found");
    }

    if (payment.status === PAYMENT_STATUSES.PAID) {
      console.log("✅ Payment already marked PAID ✅", payment._id.toString());
      return res.status(200).send("Already paid");
    }

    // ✅ Mark Payment as PAID
    payment.status = PAYMENT_STATUSES.PAID;
    payment.paidAt = new Date();
    payment.providerPayload = data;
    await payment.save();

    console.log("✅ Payment marked PAID ✅", payment._id.toString());

    // ✅ Update Job booking fee status
    const job = await Job.findById(payment.job);

    if (!job) {
      console.log("⚠️ Job not found for payment.job:", payment.job?.toString());
      return res.status(200).send("Job not found");
    }

    if (!job.pricing) job.pricing = {};
    job.pricing.bookingFeeStatus = "PAID";
    job.pricing.bookingFeePaidAt = new Date();
    await job.save();

    console.log("✅ Job bookingFee marked PAID ✅", job._id.toString());

    // ✅ Broadcast job now that booking fee is PAID
    const broadcastResult = await broadcastJobToProviders(job._id);
    console.log("✅ Job broadcast result ✅", {
      message: broadcastResult?.message,
      providers: broadcastResult?.providers?.length || 0,
    });

    return res.status(200).send("ITN Processed ✅");
  } catch (err) {
    console.error("❌ PAYFAST ITN ERROR:", err);
    return res.status(200).send("ITN error handled");
  }
});

/**
 * ✅ Customer creates booking fee payment for a Job
 * POST /api/payments/create
 */
router.post(
  "/create",
  auth,
  authorizeRoles(USER_ROLES.CUSTOMER),
  async (req, res) => {
    console.log("✅ /api/payments/create HIT ✅", req.body);

    try {
      const { jobId } = req.body;
      if (!jobId) return res.status(400).json({ message: "jobId is required" });

      const job = await Job.findById(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });

      if (job.customer.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Not authorized to pay for this job" });
      }

      if ([JOB_STATUSES.CANCELLED, JOB_STATUSES.COMPLETED].includes(job.status)) {
        return res.status(400).json({ message: `Cannot pay for job in status ${job.status}` });
      }

      const bookingFee = job.pricing?.bookingFee || 0;
      if (bookingFee <= 0) {
        return res.status(400).json({
          message: "Booking fee is not set for this job. Cannot create payment.",
        });
      }

      const activeGateway = await getActivePaymentGateway();
      const gatewayAdapter = await getGatewayAdapter();

      let payment = await Payment.findOne({ job: job._id });

      if (payment && payment.status === PAYMENT_STATUSES.PAID) {
        return res.status(200).json({
          message: "Payment already PAID ✅",
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
          provider: activeGateway,
        });
      } else {
        payment.provider = activeGateway;
        await payment.save();
      }

      const reference = `TM-${payment._id}`;

      const successUrl = `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-success`;
      const cancelUrl = `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-cancel`;

      const initResponse = await gatewayAdapter.createPayment({
        amount: bookingFee,
        currency: payment.currency,
        reference,
        successUrl,
        cancelUrl,
        notifyUrl: `${process.env.BACKEND_URL || "https://towmech-main.onrender.com"}/api/payments/notify/payfast`,
        customerEmail: req.user.email,
      });

      payment.providerReference = reference;
      payment.providerPayload = initResponse;
      await payment.save();

      const paymentUrl =
        initResponse.paymentUrl || initResponse.url || initResponse.payment_url || null;

      console.log("✅ PAYMENT URL GENERATED:", paymentUrl);

      return res.status(201).json({
        message: `${activeGateway} payment initialized ✅`,
        gateway: activeGateway,
        payment,
        paymentUrl,
        url: paymentUrl,
        initResponse,
      });
    } catch (err) {
      console.error("❌ PAYMENT CREATE ERROR:", err);
      return res.status(500).json({
        message: "Could not create payment",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ MANUAL FALLBACK
 * PATCH /api/payments/job/:jobId/mark-paid
 */
router.patch("/job/:jobId/mark-paid", auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ job: req.params.jobId });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found for job" });
    }

    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.CUSTOMER].includes(req.user.role)) {
      return res.status(403).json({
        message: "Only Admin, SuperAdmin or Customer can mark payment as paid",
      });
    }

    if (req.user.role === USER_ROLES.CUSTOMER && payment.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to mark this payment" });
    }

    if (payment.status === PAYMENT_STATUSES.PAID) {
      return res.status(200).json({ message: "Payment already PAID ✅", payment });
    }

    payment.status = PAYMENT_STATUSES.PAID;
    payment.paidAt = new Date();
    payment.providerReference = `MANUAL-${Date.now()}`;

    payment.manualMarkedBy = req.user._id;
    payment.manualMarkedAt = new Date();

    await payment.save();

    const job = await Job.findById(payment.job);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (!job.pricing) job.pricing = {};
    job.pricing.bookingFeeStatus = "PAID";
    job.pricing.bookingFeePaidAt = new Date();
    await job.save();

    const broadcastResult = await broadcastJobToProviders(job._id);

    return res.status(200).json({
      message: "Payment manually marked PAID ✅ Job broadcasted ✅",
      payment,
      broadcastResult,
    });
  } catch (err) {
    console.error("❌ MANUAL MARK-PAID ERROR:", err);
    return res.status(500).json({ message: "Could not mark payment", error: err.message });
  }
});

export default router;