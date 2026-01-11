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
 * ✅ PHP urlencode equivalent (PayFast uses PHP urlencode)
 * IMPORTANT: encodeURIComponent is NOT the same as PHP urlencode.
 * PHP urlencode:
 *  - spaces become +
 *  - also encodes: ! ' ( ) *
 */
function phpUrlencode(str) {
  return encodeURIComponent(String(str))
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) =>
      "%" + c.charCodeAt(0).toString(16).toUpperCase()
    );
}

/**
 * ✅ Generate PayFast ITN signature (matches PayFast PHP logic)
 * - remove signature
 * - add passphrase (if configured)
 * - ksort (alphabetical)
 * - build query string with phpUrlencode
 * - md5
 */
function generatePayfastItnSignature(data, passphrase = "") {
  const pfData = { ...(data || {}) };
  delete pfData.signature;

  if (passphrase && passphrase.trim() !== "") {
    pfData.passphrase = passphrase.trim();
  }

  const keys = Object.keys(pfData).sort();

  const paramString = keys
    .map((key) => {
      // PayFast includes empty strings, so keep them
      const value = pfData[key] ?? "";
      return `${key}=${phpUrlencode(value)}`;
    })
    .join("&");

  return crypto.createHash("md5").update(paramString).digest("hex");
}

/**
 * ✅ PayFast ITN Webhook
 * POST /api/payments/notify/payfast
 */
router.post(
  "/notify/payfast",
  express.urlencoded({
    extended: false,
    verify: (req, res, buf) => {
      // Keep raw body ONLY for logging/debug
      req.rawBody = buf.toString("utf8");
    },
  }),
  async (req, res) => {
    try {
      console.log("✅ PAYFAST ITN RECEIVED ✅", req.body);

      const data = req.body || {};
      const reference = data.m_payment_id; // TM-<paymentId>
      const paymentStatus = (data.payment_status || "").toUpperCase();

      if (!reference) {
        console.log("❌ ITN missing m_payment_id");
        return res.status(200).send("Missing reference");
      }

      const receivedSignature = (data.signature || "").toLowerCase();
      if (!receivedSignature) {
        console.log("❌ ITN missing signature");
        console.log("✅ ITN RAW BODY:", req.rawBody || "");
        return res.status(200).send("Missing signature");
      }

      const passphrase = (process.env.PAYFAST_PASSPHRASE || "").trim();

      const generatedSignature = generatePayfastItnSignature(data, passphrase).toLowerCase();

      console.log("✅ ITN RAW BODY:", req.rawBody || "");
      console.log("✅ ITN generatedSignature:", generatedSignature);
      console.log("✅ ITN receivedSignature :", receivedSignature);

      if (generatedSignature !== receivedSignature) {
        console.log("❌ PAYFAST ITN SIGNATURE MISMATCH ❌");
        return res.status(200).send("Signature mismatch");
      }

      console.log("✅ PAYFAST ITN SIGNATURE VERIFIED ✅");

      if (paymentStatus !== "COMPLETE") {
        console.log("⚠️ PayFast payment not COMPLETE:", paymentStatus);
        return res.status(200).send("Payment not complete");
      }

      // ✅ Find payment by providerReference = TM-<paymentId>
      const payment = await Payment.findOne({ providerReference: reference });

      if (!payment) {
        console.log("❌ Payment not found for providerReference:", reference);
        return res.status(200).send("Payment not found");
      }

      if (payment.status === PAYMENT_STATUSES.PAID) {
        console.log("✅ Payment already PAID ✅", payment._id.toString());
        return res.status(200).send("Already paid");
      }

      // ✅ Mark Payment PAID
      payment.status = PAYMENT_STATUSES.PAID;
      payment.paidAt = new Date();
      payment.providerPayload = data;
      await payment.save();

      console.log("✅ Payment marked PAID ✅", payment._id.toString());

      // ✅ Mark job booking fee PAID
      const job = await Job.findById(payment.job);

      if (!job) {
        console.log("⚠️ Job not found for payment.job:", payment.job?.toString());
        return res.status(200).send("Job not found");
      }

      // Pricing object exists in schema, but safe-guard anyway
      if (!job.pricing) job.pricing = {};

      job.pricing.bookingFeeStatus = "PAID";
      job.pricing.bookingFeePaidAt = new Date();
      await job.save();

      console.log("✅ Job bookingFee marked PAID ✅", job._id.toString());

      // ✅ Broadcast now
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
  }
);

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
        return res.status(200).json({ message: "Payment already PAID ✅", payment });
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

    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
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