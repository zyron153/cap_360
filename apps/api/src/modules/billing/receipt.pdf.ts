import PDFDocument from "pdfkit";

interface ReceiptData {
  clinic: { name: string; nif: string; address: string; phone: string; email: string };
  invoiceNumber: string;
  issuedAt: Date | null;
  patient: { fullName: string; phone: string };
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  total: number;
  amountPaid: number;
  status: string;
}

const BRAND = "#0F9191";
const DIM = "#6B7280";
const DARK = "#111827";
const GREEN = "#059669";
const RED = "#DC2626";

function formatCVE(amount: number): string {
  return `${Number(amount).toFixed(2)} CVE`;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "RASCUNHO",
  issued: "EMITIDO",
  paid: "PAGO",
  partially_paid: "PAGO PARCIAL",
  cancelled: "CANCELADO",
};

export function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 100; // usable width

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(22).fillColor(BRAND).font("Helvetica-Bold").text(data.clinic.name, 50, 50);
    doc.fontSize(9).fillColor(DIM).font("Helvetica")
      .text(data.clinic.address, 50, 76)
      .text(`${data.clinic.phone} | ${data.clinic.email}`, 50, 88);

    doc.fontSize(28).fillColor(DARK).font("Helvetica-Bold")
      .text("RECIBO", 50, 50, { align: "right", width: W });
    doc.fontSize(10).fillColor(DIM).font("Helvetica")
      .text(`N.º ${data.invoiceNumber}`, 50, 84, { align: "right", width: W });

    const issuedDate = (data.issuedAt ?? new Date()).toLocaleDateString("pt-PT", {
      day: "2-digit", month: "long", year: "numeric",
    });
    doc.text(issuedDate, 50, 96, { align: "right", width: W });

    doc.moveTo(50, 120).lineTo(545, 120).strokeColor("#E5E7EB").lineWidth(1).stroke();

    // ── Patient & status ─────────────────────────────────────────────────────
    doc.fontSize(8).fillColor(DIM).font("Helvetica-Bold").text("PACIENTE", 50, 135);
    doc.fontSize(12).fillColor(DARK).font("Helvetica-Bold").text(data.patient.fullName, 50, 148);
    doc.fontSize(9).fillColor(DIM).font("Helvetica").text(data.patient.phone, 50, 163);

    const statusColor = data.status === "paid" ? GREEN : data.status === "cancelled" ? RED : BRAND;
    doc.fontSize(9).fillColor(statusColor).font("Helvetica-Bold")
      .text(STATUS_LABELS[data.status] ?? data.status.toUpperCase(), 50, 148, { align: "right", width: W });

    // ── Line items ──────────────────────────────────────────────────────────
    const tY = 198;
    doc.fontSize(8).fillColor(DIM).font("Helvetica-Bold")
      .text("DESCRIÇÃO", 50, tY)
      .text("QTD", 360, tY, { width: 40, align: "right" })
      .text("PREÇO UNIT.", 408, tY, { width: 80, align: "right" })
      .text("TOTAL", 495, tY, { width: 50, align: "right" });

    doc.moveTo(50, tY + 14).lineTo(545, tY + 14).strokeColor("#E5E7EB").lineWidth(0.5).stroke();

    let rY = tY + 24;
    for (const item of data.items) {
      doc.fontSize(10).fillColor(DARK).font("Helvetica")
        .text(item.description, 50, rY, { width: 295 })
        .text(String(item.quantity), 360, rY, { width: 40, align: "right" })
        .text(formatCVE(item.unitPrice), 408, rY, { width: 80, align: "right" })
        .text(formatCVE(item.total), 495, rY, { width: 50, align: "right" });
      rY += 24;
    }

    doc.moveTo(50, rY + 4).lineTo(545, rY + 4).strokeColor("#E5E7EB").lineWidth(0.5).stroke();

    // ── Totals ──────────────────────────────────────────────────────────────
    rY += 18;
    doc.fontSize(10).fillColor(DIM).font("Helvetica")
      .text("Subtotal", 350, rY, { width: 145, align: "right" })
      .fillColor(DARK).text(formatCVE(data.subtotal), 50, rY, { width: W, align: "right" });

    rY += 20;
    doc.font("Helvetica-Bold").fillColor(BRAND)
      .text("TOTAL", 350, rY, { width: 145, align: "right" });
    doc.fontSize(12).fillColor(DARK).text(formatCVE(data.total), 50, rY, { width: W, align: "right" });

    if (data.amountPaid > 0) {
      rY += 22;
      doc.fontSize(9).fillColor(GREEN).font("Helvetica")
        .text(`Pago: ${formatCVE(data.amountPaid)}`, 50, rY, { width: W, align: "right" });
      if (data.total - data.amountPaid > 0) {
        rY += 16;
        doc.fillColor(RED).text(`Saldo: ${formatCVE(data.total - data.amountPaid)}`, 50, rY, { width: W, align: "right" });
      }
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor(DIM).font("Helvetica")
      .text(
        `${data.clinic.name}  •  NIF: ${data.clinic.nif}  •  Este documento foi gerado automaticamente.`,
        50, 760, { align: "center", width: W }
      );

    doc.end();
  });
}
