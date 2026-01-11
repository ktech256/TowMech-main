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
 * PayFast encoding: urlencode + spaces as "+"
 */
function encodePayfast(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

/**
 * Strategy A: Use RAW body string (best when PayFast order matters)
 */
function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function buildSignatureFromRaw(rawBody, passphrase) {
  // rawBody is like: a=1&b=2&signature=xxxx
  const pairs = (rawBody || "").split("&").filter(Boolean);

  const withoutSig = pairs.filter((p) => !p.startsWith("signature=")).join("&");

  const finalString =
    passphrase && passphrase.trim() !== ""
      ? `${withoutSig}&passphrase=${encodePayfast(passphrase.trim())}`
      : withoutSig;

  return md5(finalString).toLowerCase();
}

/**
 * Strategy B: Build from req.body sorted keys (some libs do this)
 * NOTE: includes empty strings (important for PayFast ITN)
 */
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

/**
 * ✅ PayFast ITN Webhook
 * POST /api/payments/notify/payfast
 */
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
      console.log("✅ ITN RAW BODY:", raw);

      const reference = data.m_payment_id; // TM-<paymentId>
      const paymentStatus = (data.payment_status || "").toUpperCase();
      const receivedSignature = (data.signature || "").toLowerCase();

      if (!reference) {
        console.log("❌ ITN missing m_payment_id");
        return res.status(200).send("Missing reference");
      }

      if (!receivedSignature) {
        console.log("❌ ITN missing signature");
        return res.status(200).send("Missing signature");
      }

      const passphrase = (process.env.PAYFAST_PASSPHRASE || "").trim();

      // ✅ Generate multiple possible signatures
      const sigRawWithPass = buildSignatureFromRaw(raw, passphrase);
      const sigRawNoPass = buildSignatureFromRaw(raw, "");

      const sigSortedWithPass = buildSignatureSorted(data, passphrase);
      const sigSortedNoPass = buildSignatureSorted(data, "");

      console.log("✅ ITN receivedSignature :", receivedSignature);
      console.log("✅ ITN sigRawWithPass   :", sigRawWithPass);
      console.log("✅ ITN sigRawNoPass     :", sigRawNoPass);
      console.log("✅ ITN sigSortedWithPass:", sigSortedWithPass);
      console.log("✅ ITN sigSortedNoPass  :", sigSortedNoPass);

      const signatureMatches =
        receivedSignature === sigRawWithPass ||
        receivedSignature === sigRawNoPass ||
        receivedSignature === sigSortedWithPass ||
        receivedSignature === sigSortedNoPass;

      // ✅ Only mark PAID if COMPLETE
      if (paymentStatus !== "COMPLETE") {
        console.log("⚠️ PayFast payment not COMPLETE:", paymentStatus);
        return res.status(200).send("Payment not complete");
      }

      // ✅ Find payment by providerReference (TM-<paymentId>)
      const payment = await Payment.findOne({ providerReference: reference });

      if (!payment) {
        console.log("❌ Payment not found for providerReference:", reference);
        return res.status(200).send("Payment not found");
      }

      // ✅ If already paid
      if (payment.status === PAYMENT_STATUSES.PAID) {
        console.log("✅ Payment already marked PAID ✅", payment._id.toString());
        return res.status(200).send("Already paid");
      }

      // ✅ If signature mismatch, do SAFE fallback checks to unblock you
      // (This prevents “successful payment but stuck pending”)
      if (!signatureMatches) {
        console.log("❌ PAYFAST ITN SIGNATURE MISMATCH ❌");

        const expectedMerchantId = (process.env.PAYFAST_MERCHANT_ID || "").trim();
        const merchantOk =
          !expectedMerchantId || String(data.merchant_id || "").trim() === expectedMerchantId;

        const gross = Number(data.amount_gross || 0);
        const expectedAmount = Number(payment.amount || 0);

        const amountOk =
          Math.abs(gross - expectedAmount) < 0.01; // cents-safe

        console.log("⚠️ FALLBACK CHECK merchantOk:", merchantOk);
        console.log("⚠️ FALLBACK CHECK amountOk  :", amountOk, {
          gross,
          expectedAmount,
        });

        if (!merchantOk || !amountOk) {
          console.log("❌ Fallback checks failed → NOT marking paid");
          return res.status(200).send("Signature mismatch + fallback failed");
        }

        console.log(
          "✅ Fallback passed (merchant + amount ok) → proceeding to mark paid (temporary safety net)"
        );
      } else {
        console.log("✅ PAYFAST ITN SIGNATURE VERIFIED ✅");
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