// backend/src/utils/pdf/invoicePdf.js
import PDFDocument from "pdfkit";

/**
 * Professional but simple PDF renderer for the invoice JSON.
 * Returns a Buffer (so Express can send it as download).
 */
export async function renderInvoicePdfToBuffer(invoice) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        info: {
          Title: "TowMech Insurance Invoice",
        },
      });

      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const currency = invoice?.currency || "ZAR";
      const partner = invoice?.partner || {};
      const period = invoice?.period || {};
      const totals = invoice?.totals || {};
      const items = Array.isArray(invoice?.items) ? invoice.items : [];
      const grouped = Array.isArray(invoice?.groupedByProvider) ? invoice.groupedByProvider : [];

      // Header
      doc.fontSize(18).text("TowMech — Insurance Invoice", { align: "left" });
      doc.moveDown(0.2);
      doc
        .fontSize(10)
        .fillColor("#444444")
        .text(`Generated: ${new Date().toISOString()}`)
        .fillColor("#000000");

      doc.moveDown(1);

      // Partner block
      doc.fontSize(12).text("Partner", { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`Name: ${partner.name || "-"}`);
      doc.text(`Code: ${partner.partnerCode || "-"}`);
      doc.text(`Email: ${partner.email || "-"}`);
      doc.text(`Phone: ${partner.phone || "-"}`);
      doc.moveDown(0.6);

      // Period block
      doc.fontSize(12).text("Period", { underline: true });
      doc.moveDown(0.3);
      if (period.month) doc.fontSize(10).text(`Month: ${period.month}`);
      doc.fontSize(10).text(`From: ${period.from || "-"}`);
      doc.fontSize(10).text(`To:   ${period.to || "-"}`);
      doc.moveDown(0.6);

      // Totals block
      doc.fontSize(12).text("Totals", { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`Total jobs: ${safeNum(totals.totalJobs)}`);
      doc.text(`Total job amount (estimatedTotal): ${safeNum(totals.totalEstimatedTotal)} ${currency}`);
      doc.text(`Total booking fee waived: ${safeNum(totals.totalBookingFeeWaived)} ${currency}`);
      doc.text(`Total commission: ${safeNum(totals.totalCommission)} ${currency}`);
      doc.text(`Total provider amount due: ${safeNum(totals.totalProviderAmountDue)} ${currency}`);
      doc.moveDown(0.8);

      // Providers owed summary
      doc.fontSize(12).text("Providers Owed Summary", { underline: true });
      doc.moveDown(0.4);

      if (grouped.length === 0) {
        doc.fontSize(10).text("No provider assignments found for this period.");
      } else {
        for (const p of grouped) {
          doc
            .fontSize(10)
            .text(
              `• ${p.name || "Unknown Provider"} (${p.providerId}) — Jobs: ${safeNum(p.jobCount)} — Due: ${safeNum(
                p.totalProviderAmountDue
              )} ${currency}`
            );
        }
      }

      doc.moveDown(0.8);

      // Items table title
      doc.fontSize(12).text(`Jobs (${items.length})`, { underline: true });
      doc.moveDown(0.4);

      // Table header
      const startX = doc.x;
      let y = doc.y;

      const col = {
        job: startX,
        date: startX + 80,
        provider: startX + 170,
        amount: startX + 390,
        due: startX + 470,
      };

      doc.fontSize(9).fillColor("#000000");
      doc.text("JOB", col.job, y);
      doc.text("DATE", col.date, y);
      doc.text("PROVIDER", col.provider, y);
      doc.text(`AMOUNT (${currency})`, col.amount, y, { width: 70, align: "right" });
      doc.text(`DUE (${currency})`, col.due, y, { width: 70, align: "right" });

      y += 12;
      doc.moveTo(startX, y).lineTo(startX + 515, y).stroke();
      y += 8;

      // Rows
      for (const it of items) {
        if (y > 760) {
          doc.addPage();
          y = doc.y;
        }

        const created = it?.createdAt ? String(it.createdAt).slice(0, 19).replace("T", " ") : "-";
        const provName = it?.provider?.name || "-";
        const provId = it?.provider?.providerId ? String(it.provider.providerId).slice(-8) : "";
        const provLabel = provId ? `${provName} (${provId})` : provName;

        doc.fontSize(9).fillColor("#000000");
        doc.text(it?.shortId || "-", col.job, y, { width: 70 });
        doc.text(created, col.date, y, { width: 85 });
        doc.text(provLabel, col.provider, y, { width: 210 });

        doc.text(String(safeNum(it?.pricing?.estimatedTotal)), col.amount, y, { width: 70, align: "right" });
        doc.text(String(safeNum(it?.pricing?.providerAmountDue)), col.due, y, { width: 70, align: "right" });

        y += 14;

        // Pickup/Dropoff line
        const pickup = it?.pickupAddressText || "-";
        const dropoff = it?.dropoffAddressText || "-";
        doc
          .fontSize(8)
          .fillColor("#555555")
          .text(`Pickup: ${pickup}`, col.date, y, { width: 460 })
          .text(`Dropoff: ${dropoff}`, col.date, y + 10, { width: 460 })
          .fillColor("#000000");

        y += 26;
      }

      doc.moveDown(1);

      // Footer
      doc.fontSize(8).fillColor("#666666").text("TowMech Admin — Generated invoice PDF", {
        align: "left",
      });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function safeNum(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}