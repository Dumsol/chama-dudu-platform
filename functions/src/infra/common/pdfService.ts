// functions/src/infra/common/pdfService.ts

import PDFDocument from "pdfkit";
import { storage } from "../config/firebase";
import * as logger from "firebase-functions/logger";

interface ReceiptData {
  tenantId: string;
  orderId: string;
  merchantName: string;
  merchantCnpj: string;
  merchantAddress: string;
  items: string;
  total?: string;
  customerPhone: string;
}

/**
 * Service to generate personalized PDF receipts for Chama Dudu.
 * Uploads the generated PDF to Firebase Storage and returns the public link.
 */
export async function generateReceiptPdf(data: ReceiptData): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", async () => {
        const buffer = Buffer.concat(chunks);
        const fileName = `receipts/${data.tenantId}/${data.orderId}.pdf`;
        const file = storage.bucket().file(fileName);

        await file.save(buffer, {
          contentType: "application/pdf",
          metadata: {
            cacheControl: "public, max-age=31536000",
          },
        });

        // Make it public or get a signed URL
        // For simplicity in this demo, we'll assume a public bucket or metadata-based access
        const [url] = await file.getSignedUrl({
          action: "read",
          expires: "03-01-2500", // "Permanent" enough for UX
        });

        resolve(url);
      });

      // --- PDF Content ---

      // Header
      doc.fontSize(20).text("CHAMA DUDU", { align: "center" });
      doc.fontSize(10).text("Tô no corre por você! 🏍️", { align: "center" });
      doc.moveDown();

      // Merchant Info
      doc.fontSize(14).text(data.merchantName.toUpperCase(), { underline: true });
      doc.fontSize(10).text(`CNPJ: ${data.merchantCnpj}`);
      doc.text(`Localização: ${data.merchantAddress}`);
      doc.moveDown();

      doc.rect(50, doc.y, 500, 2).fill("#000000");
      doc.moveDown();

      // Order Details
      doc.fontSize(14).text("DETALHES DO PEDIDO", { align: "left" });
      doc.fontSize(12).text(`ID: ${data.orderId}`);
      doc.text(`Para: ${data.customerPhone}`);
      doc.moveDown();

      doc.fontSize(11).text(data.items);

      if (data.total) {
        doc.moveDown();
        doc.fontSize(16).text(`TOTAL: ${data.total}`, { align: "right" });
      }

      // Footer
      doc.moveDown(4);
      doc.fontSize(10).text("Obrigado por pedir com o Dudu! 🤙", { align: "center", oblique: true });
      doc.text("Acesse: chamadudu.com.br", { align: "center", link: "https://chamadudu.com.br" });

      doc.end();
    } catch (error) {
      logger.error("PDF_GENERATION_FAILED", { orderId: data.orderId, error: String(error) });
      resolve(null);
    }
  });
}
