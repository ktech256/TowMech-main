import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

import app from "./app.js";
import connectDB from "./config/db.js";

// ✅ get current file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ FORCE LOAD backend/.env
dotenv.config({ path: path.join(__dirname, "../.env") });

const PORT = process.env.PORT || 5000;

/**
 * ✅ RAW BODY CAPTURE (PayFast ITN - strongest fix)
 *
 * Why:
 * - If you have ANY global body parser (urlencoded/json) that runs BEFORE your /notify/payfast route,
 *   it can consume the request stream and your route-level "verify" won't see the raw bytes.
 *
 * What this does:
 * - Adds urlencoded + json parsers WITH a verify hook that stores req.rawBody
 * - Ensures this runs FIRST by unshifting into Express router stack (so it precedes routes even if they
 *   were already registered inside app.js).
 */
const rawBodyCaptureParsers = [
  express.urlencoded({
    extended: false,
    verify: (req, res, buf) => {
      // PayFast sends x-www-form-urlencoded
      req.rawBody = buf.toString("utf8");
    },
  }),
  express.json({
    verify: (req, res, buf) => {
      // Keep this too (doesn't hurt) in case you ever verify JSON webhooks similarly
      req.rawBody = buf.toString("utf8");
    },
  }),
];

// ✅ Force these parsers to the TOP of the middleware stack
try {
  // If app.js already created the router stack, unshift to guarantee first execution order
  if (app?._router?.stack && Array.isArray(app._router.stack)) {
    // Insert in reverse so urlencoded ends up before json (order not critical here)
    rawBodyCaptureParsers
      .slice()
      .reverse()
      .forEach((mw) => {
        app._router.stack.unshift({
          route: undefined,
          name: mw.name || "<rawBodyCapture>",
          handle: mw,
        });
      });

    console.log("✅ RAW BODY CAPTURE enabled (prepended to middleware stack) ✅");
  } else {
    // Fallback: add normally (works if routes are registered later in app.js)
    rawBodyCaptureParsers.forEach((mw) => app.use(mw));
    console.log("✅ RAW BODY CAPTURE enabled (app.use fallback) ✅");
  }
} catch (e) {
  // Last resort: don't crash the server if Express internals differ
  rawBodyCaptureParsers.forEach((mw) => app.use(mw));
  console.log("✅ RAW BODY CAPTURE enabled (safe fallback) ✅");
}

(async () => {
  try {
    console.log("✅ server.js started");
    console.log(
      "✅ ENV CHECK:",
      process.env.MONGODB_URI ? "Loaded ✅" : "Missing ❌"
    );

    await connectDB();
    console.log("✅ DB connected");

    app.listen(PORT, () => {
      console.log(`✅ TowMech API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
})();