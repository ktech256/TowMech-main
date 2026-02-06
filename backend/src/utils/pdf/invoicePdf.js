// backend/src/utils/pdf/invoicePdf.js
import PDFDocument from "pdfkit";

/**
 * ✅ Professional Insurance Billing PDFs (Landscape)
 * - Partner invoice (gross claim - no deductions)
 * - Providers owed summary (tabulated by provider)
 * - Provider detailed statement (job breakdown)
 */

function money(n) {
  const v = Number(n || 0) || 0;
  return v.toFixed(2);
}

function safe(s) {
  if (s === null || s === undefined) return "";
  return String(s);
}

function ymd(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function titlePeriod(period) {
  if (period?.month) return `Month: ${period.month}`;
  return `From ${ymd(period?.from)} to ${ymd(period?.to)}`;
}

function createDocLandscape() {
  return new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 36,
    info: {
      Title: "TowMech Insurance Billing",
      Author: "TowMech",
    },
  });
}

/**
 * Page geometry helpers (landscape)
 */
function pageBox(doc) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const top = doc.page.margins.top;
  const bottom = doc.page.height - doc.page.margins.bottom;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function hr(doc, y, color = "#111111") {
  const { left, right } = pageBox(doc);
  doc.save();
  doc.lineWidth(1);
  doc.strokeColor(color);
  doc.moveTo(left, y).lineTo(right, y).stroke();
  doc.restore();
}

/**
 * ✅ FIX: return doc so callers can chain .fill() / .fillAndStroke()
 */
function drawRoundedRect(doc, x, y, w, h, r = 8) {
  return doc.roundedRect(x, y, w, h, r);
}

/**
 * ✅ Professional header with brand + title + invoice meta block
 */
function addHeader(doc, heading, invoice) {
  const { left, right } = pageBox(doc);

  // Brand line
  doc.save();
  doc.fillColor("#111827");
  doc.font("Helvetica-Bold").fontSize(18).text("TowMech", left, doc.y, { continued: true });
  doc.font("Helvetica").fontSize(10).fillColor("#374151").text("  |  Insurance Billing", { continued: false });
  doc.restore();

  doc.moveDown(0.25);

  // Title
  doc.save();
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827").text(heading, left, doc.y);
  doc.restore();

  doc.moveDown(0.5);

  // Meta block
  const boxY = doc.y;
  const boxH = 54;
  const boxW = right - left;

  doc.save();
  doc.fillColor("#F3F4F6");
  drawRoundedRect(doc, left, boxY, boxW, boxH, 10).fill();
  doc.restore();

  doc.save();
  doc.fillColor("#111827");
  doc.fontSize(10).font("Helvetica");

  const partnerName = safe(invoice?.partner?.name);
  const partnerCode = safe(invoice?.partner?.partnerCode);
  const cc = safe(invoice?.countryCode);
  const currency = safe(invoice?.currency);
  const periodText = titlePeriod(invoice?.period);

  // Left meta
  doc.text(`Partner: ${partnerName}${partnerCode ? ` (${partnerCode})` : ""}`, left + 14, boxY + 12);
  doc.text(`Period: ${periodText}`, left + 14, boxY + 30);

  // Right meta
  const rightColX = left + boxW * 0.68;
  doc.text(`Country: ${cc}`, rightColX, boxY + 12);
  doc.text(`Currency: ${currency}`, rightColX, boxY + 30);

  doc.restore();

  doc.y = boxY + boxH + 14;

  hr(doc, doc.y, "#E5E7EB");
  doc.moveDown(0.7);
}

/**
 * ✅ Totals panel (boxed)
 */
function totalsPanel(doc, title, lines) {
  const { left, right } = pageBox(doc);
  const boxW = right - left;
  const boxY = doc.y;
  const boxH = 78;

  doc.save();
  doc.fillColor("#FFFFFF");
  doc.strokeColor("#E5E7EB");
  doc.lineWidth(1);
  drawRoundedRect(doc, left, boxY, boxW, boxH, 10).fillAndStroke();
  doc.restore();

  doc.save();
  doc.fillColor("#111827");
  doc.font("Helvetica-Bold").fontSize(12).text(title, left + 14, boxY + 12);
  doc.restore();

  doc.save();
  doc.fillColor("#111827");
  doc.font("Helvetica").fontSize(10);

  let y = boxY + 32;
  for (const ln of lines) {
    doc.text(ln, left + 14, y);
    y += 14;
  }
  doc.restore();

  doc.y = boxY + boxH + 14;
}

function amountCalloutRight(doc, label, valueText) {
  const { right } = pageBox(doc);
  const w = 220;
  const h = 74;
  const x = right - w;
  const y = doc.y;

  doc.save();
  doc.fillColor("#111827");
  drawRoundedRect(doc, x, y, w, h, 12).fill();
  doc.restore();

  doc.save();
  doc.fillColor("#FFFFFF");
  doc.font("Helvetica-Bold").fontSize(10).text(label, x + 14, y + 14);
  doc.font("Helvetica-Bold").fontSize(18).text(valueText, x + 14, y + 34);
  doc.restore();

  doc.y = y + h + 10;
}

/**
 * ✅ Table renderer for landscape with:
 * - header shading
 * - row separators
 * - page breaks that redraw header row
 */
function drawTable(doc, columns, rows) {
  const { left, right, bottom } = pageBox(doc);

  const usableW = right - left;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const scale = totalW > usableW ? usableW / totalW : 1;
  const cols = columns.map((c) => ({ ...c, w: c.width * scale }));

  const rowH = 18;
  const headerH = 22;

  function drawHeaderRow(y) {
    doc.save();
    doc.fillColor("#F3F4F6");
    doc.rect(left, y, usableW, headerH).fill();
    doc.restore();

    doc.save();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
    let x = left + 8;
    const textY = y + 6;

    for (const c of cols) {
      doc.text(c.label, x, textY, { width: c.w - 10, align: c.align || "left" });
      x += c.w;
    }
    doc.restore();

    doc.save();
    doc.strokeColor("#E5E7EB").lineWidth(1);
    doc.moveTo(left, y + headerH).lineTo(right, y + headerH).stroke();
    doc.restore();
  }

  let y = doc.y;
  drawHeaderRow(y);
  y += headerH;

  doc.save();
  doc.font("Helvetica").fontSize(9).fillColor("#111827");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    if (y + rowH > bottom - 18) {
      doc.addPage();
      y = doc.y;
      drawHeaderRow(y);
      y += headerH;
    }

    let x = left + 8;
    for (const c of cols) {
      const text = safe(r[c.key]);
      doc.text(text, x, y + 4, { width: c.w - 10, align: c.align || "left" });
      x += c.w;
    }

    doc.save();
    doc.strokeColor("#F3F4F6").lineWidth(1);
    doc.moveTo(left, y + rowH).lineTo(right, y + rowH).stroke();
    doc.restore();

    y += rowH;
  }
  doc.restore();

  doc.y = y + 12;
}

function bufferFromDoc(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * 1) ✅ Partner invoice (insurance company owes you)
 */
export async function renderPartnerInvoicePdfBuffer(invoice) {
  const doc = createDocLandscape();
  addHeader(doc, "Insurance Partner Invoice (Amount Due)", invoice);

  const t = invoice?.totals || {};
  const currency = safe(invoice?.currency);

  totalsPanel(doc, "Totals", [
    `Total jobs: ${safe(t.totalJobs)}`,
    `Gross total (partner owes): ${money(t.totalPartnerAmountDue)} ${currency}`,
    `(Info) Booking fee waived: ${money(t.totalBookingFeeWaived)} ${currency}`,
    `(Info) Commission total: ${money(t.totalCommission)} ${currency}`,
  ]);

  amountCalloutRight(doc, "TOTAL AMOUNT DUE", `${money(t.totalPartnerAmountDue)} ${currency}`);

  doc.save();
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text("Jobs Included");
  doc.restore();
  doc.moveDown(0.4);

  const rows = (invoice?.items || []).map((it) => ({
    shortId: it.shortId,
    createdAt: ymd(it.createdAt),
    provider: it?.provider?.name || "-",
    pickup: safe(it.pickupAddressText || "-"),
    dropoff: safe(it.dropoffAddressText || "-"),
    gross: money(it?.pricing?.estimatedTotal),
    code: it?.insurance?.code || "-",
  }));

  drawTable(
    doc,
    [
      { key: "shortId", label: "Job", width: 70 },
      { key: "createdAt", label: "Date", width: 80 },
      { key: "provider", label: "Provider", width: 140 },
      { key: "pickup", label: "Pickup", width: 190 },
      { key: "dropoff", label: "Dropoff", width: 190 },
      { key: "gross", label: "Gross", width: 70, align: "right" },
      { key: "code", label: "Ins Code", width: 80 },
    ],
    rows
  );

  doc.save();
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text(
    `TOTAL AMOUNT DUE: ${money(t.totalPartnerAmountDue)} ${currency}`,
    { align: "right" }
  );
  doc.restore();

  return bufferFromDoc(doc);
}

/**
 * 2) ✅ Providers owed summary (tabulated)
 */
export async function renderProvidersSummaryPdfBuffer(invoice) {
  const doc = createDocLandscape();
  addHeader(doc, "Providers Owed Summary (Tabulated)", invoice);

  const t = invoice?.totals || {};
  const currency = safe(invoice?.currency);

  totalsPanel(doc, "Totals", [
    `Total jobs: ${safe(t.totalJobs)}`,
    `Total provider amount due (NET): ${money(t.totalProviderAmountDue)} ${currency}`,
    `(Info) Total commission/booking fee: ${money(t.totalCommission)} ${currency}`,
  ]);

  amountCalloutRight(doc, "TOTAL NET DUE (ALL PROVIDERS)", `${money(t.totalProviderAmountDue)} ${currency}`);

  doc.save();
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text("Providers");
  doc.restore();
  doc.moveDown(0.4);

  const rows = (invoice?.groupedByProvider || []).map((p) => ({
    name: p?.name || "Unknown",
    providerId: safe(p?.providerId),
    jobs: String(p?.jobCount || 0),
    gross: money(p?.grossTotal),
    commission: money(p?.commissionTotal),
    net: money(p?.netTotalDue),
  }));

  drawTable(
    doc,
    [
      { key: "name", label: "Provider", width: 210 },
      { key: "providerId", label: "Provider ID", width: 210 },
      { key: "jobs", label: "Jobs", width: 55, align: "right" },
      { key: "gross", label: "Gross", width: 90, align: "right" },
      { key: "commission", label: "Commission", width: 110, align: "right" },
      { key: "net", label: "Net Due", width: 90, align: "right" },
    ],
    rows
  );

  doc.save();
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text(
    `TOTAL NET DUE (ALL PROVIDERS): ${money(t.totalProviderAmountDue)} ${currency}`,
    { align: "right" }
  );
  doc.restore();

  return bufferFromDoc(doc);
}

/**
 * 3) ✅ Provider detailed statement PDF
 */
export async function renderProviderDetailPdfBuffer(invoice, providerId) {
  const doc = createDocLandscape();

  const pid = String(providerId || "").trim();
  if (!pid) {
    doc.fontSize(12).text("providerId is required for detailed provider statement.");
    return bufferFromDoc(doc);
  }

  const providerBlock =
    (invoice?.groupedByProvider || []).find((p) => String(p?.providerId) === pid) || null;

  addHeader(doc, "Provider Detailed Statement", invoice);

  const currency = safe(invoice?.currency);

  const { left, right } = pageBox(doc);
  const boxY = doc.y;
  const boxW = right - left;
  const boxH = 86;

  doc.save();
  doc.fillColor("#FFFFFF");
  doc.strokeColor("#E5E7EB");
  doc.lineWidth(1);
  drawRoundedRect(doc, left, boxY, boxW, boxH, 10).fillAndStroke();
  doc.restore();

  doc.save();
  doc.fillColor("#111827");
  doc.font("Helvetica-Bold").fontSize(12).text("Provider", left + 14, boxY + 12);
  doc.font("Helvetica").fontSize(10);
  doc.text(`Name: ${safe(providerBlock?.name || "Unknown Provider")}`, left + 14, boxY + 32);
  doc.text(`ProviderId: ${safe(pid)}`, left + 14, boxY + 46);

  if (providerBlock?.email) doc.text(`Email: ${safe(providerBlock.email)}`, left + 320, boxY + 32);
  if (providerBlock?.phone) doc.text(`Phone: ${safe(providerBlock.phone)}`, left + 320, boxY + 46);

  doc.font("Helvetica-Bold").fontSize(11).text(
    `NET AMOUNT DUE: ${money(providerBlock?.netTotalDue)} ${currency}`,
    left + 14,
    boxY + 64
  );
  doc.restore();

  doc.y = boxY + boxH + 14;

  doc.save();
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text("Insurance Partner (Requester)");
  doc.font("Helvetica").fontSize(10).fillColor("#111827");
  doc.text(`Partner: ${safe(invoice?.partner?.name)} (${safe(invoice?.partner?.partnerCode)})`);
  doc.restore();

  doc.moveDown(0.8);

  totalsPanel(doc, "Summary", [
    `Jobs: ${safe(providerBlock?.jobCount || 0)}`,
    `Gross total: ${money(providerBlock?.grossTotal)} ${currency}`,
    `Commission (booking fee): ${money(providerBlock?.commissionTotal)} ${currency}`,
    `Net amount due: ${money(providerBlock?.netTotalDue)} ${currency}`,
  ]);

  doc.save();
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text("Job Breakdown");
  doc.restore();
  doc.moveDown(0.4);

  const jobs = (providerBlock?.jobs || []).map((j) => ({
    shortId: j.shortId,
    createdAt: ymd(j.createdAt),
    status: j.status,
    pickup: safe(j.pickupAddressText || "-"),
    dropoff: safe(j.dropoffAddressText || "-"),
    gross: money(j.estimatedTotal),
    comm: money(j.commissionAmount),
    net: money(j.providerAmountDue),
    code: j.insuranceCode || "-",
  }));

  drawTable(
    doc,
    [
      { key: "shortId", label: "Job", width: 70 },
      { key: "createdAt", label: "Date", width: 85 },
      { key: "status", label: "Status", width: 90 },
      { key: "pickup", label: "Pickup", width: 185 },
      { key: "dropoff", label: "Dropoff", width: 185 },
      { key: "gross", label: "Gross", width: 70, align: "right" },
      { key: "comm", label: "Comm", width: 70, align: "right" },
      { key: "net", label: "Net", width: 70, align: "right" },
      { key: "code", label: "Ins Code", width: 80 },
    ],
    jobs
  );

  doc.save();
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text(
    `NET AMOUNT DUE: ${money(providerBlock?.netTotalDue)} ${currency}`,
    { align: "right" }
  );
  doc.restore();

  return bufferFromDoc(doc);
}