// functions/src/app/http/receipt.ts
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { db } from "../../infra/config/firebase";
import { depositosCol } from "../../infra/firestore/duduPaths";
import { logEvent } from "../../infra/obs/eventLogService";

function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function normalizePaper(value: string | null | undefined): "58" | "80" {
  return value === "80" ? "80" : "58";
}

function safeString(value: unknown, max = 200): string {
  return String(value ?? "").slice(0, max).trim();
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function extractTenantFromOrderPath(path: string): string | null {
  const parts = String(path ?? "").split("/");
  const idx = parts.indexOf("tenants");
  if (idx < 0 || idx + 1 >= parts.length) return null;
  return String(parts[idx + 1] ?? "").trim() || null;
}

function buildReceiptHtml(params: {
  paper: "58" | "80";
  publicCode: string;
  depositoNome: string;
  createdAtMs: number;
  clienteNome: string;
  clienteWaId: string;
  endereco: string;
  bairro: string;
  referencia: string;
  itens: string[];
  subtotal: number;
  serviceFee: number;
  totalToCollect: number;
  receiptUrl: string;
}): string {
  const paperWidth = params.paper === "80" ? "80mm" : "58mm";
  const qrUrl =
    "https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=" +
    encodeURIComponent(params.receiptUrl);

  const itensHtml = params.itens.length
    ? params.itens.map((i) => `<div class="item">${i}</div>`).join("")
    : `<div class="item">Sem descricao de itens.</div>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${params.publicCode}</title>
  <style>
    @page { size: ${paperWidth} auto; margin: 4mm; }
    body { font-family: "Courier New", monospace; font-size: 12px; margin: 0; }
    .wrap { width: ${paperWidth}; }
    .title { font-weight: bold; font-size: 14px; margin-bottom: 6px; }
    .section { margin-top: 6px; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .item { margin: 2px 0; }
    .right { text-align: right; }
    .small { font-size: 11px; }
    .qr { margin-top: 8px; text-align: center; }
    .footer { margin-top: 8px; font-size: 11px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">${params.publicCode}</div>
    <div>Deposito: ${params.depositoNome || "N/D"}</div>
    <div>Data: ${formatDateTime(params.createdAtMs)}</div>
    <div class="divider"></div>
    <div>Cliente: ${params.clienteNome || "Cliente"} (${params.clienteWaId || "N/D"})</div>
    <div>Endereco: ${params.endereco || "N/D"}</div>
    <div>Bairro: ${params.bairro || "N/D"}</div>
    ${params.referencia ? `<div>Ref: ${params.referencia}</div>` : ""}
    <div class="divider"></div>
    <div class="section"><strong>Itens</strong></div>
    ${itensHtml}
    <div class="divider"></div>
    <div>Subtotal: ${formatBRL(params.subtotal)}</div>
    <div>Taxa Dudu: ${formatBRL(params.serviceFee)}</div>
    <div><strong>Total a cobrar: ${formatBRL(params.totalToCollect)}</strong></div>
    <div class="divider"></div>
    <div class="footer">
      Pedido feito pelo Chama Dudu. Deposito responsavel: ${params.depositoNome || "N/D"}.
      Valeu por confiar no Dudu.
    </div>
    <div class="qr">
      <div class="small">QR do comprovante</div>
      <img src="${qrUrl}" alt="QR" />
      <div class="small">${params.receiptUrl}</div>
    </div>
  </div>
  <script>window.print();</script>
</body>
</html>`;
}

export const renderReceiptHtmlV1 = onRequest(renderReceiptHtmlHandler);

export async function renderReceiptHtmlHandler(req: any, res: any) {
  const orderId = safeString((req.query.orderId as string) ?? (req.body as any)?.orderId ?? "");
  const printKey = safeString((req.query.printKey as string) ?? (req.body as any)?.printKey ?? "");
  const paper = normalizePaper(
    safeString((req.query.paper as string) ?? (req.body as any)?.paper ?? "58"),
  );

  if (!orderId || !printKey) {
    res.status(400).send("missing orderId or printKey");
    return;
  }

  const orderSnap = await db
    .collectionGroup("orders")
    .where("printKey", "==", printKey)
    .limit(5)
    .get();
  if (orderSnap.empty) {
    res.status(404).send("order not found");
    return;
  }

  const orderDoc = orderSnap.docs.find((d) => d.id === orderId) ?? null;
  if (!orderDoc) {
    res.status(404).send("order not found");
    return;
  }

  const tenantCnpj = extractTenantFromOrderPath(orderDoc.ref.path);
  if (!tenantCnpj) {
    res.status(500).send("tenant not resolved");
    return;
  }

  const order = orderDoc.data() as any;
  if (!order?.printKey || String(order.printKey) !== printKey) {
    res.status(403).send("invalid printKey");
    return;
  }

  const depositoId = safeString(order?.depositoId ?? "");
  const depSnap = depositoId ? await depositosCol(tenantCnpj).doc(depositoId).get() : null;
  const depositoNome = depSnap?.exists ? safeString((depSnap.data() as any)?.nome ?? "", 120) : "N/D";

  const pricing = order?.pricing ?? {};
  const subtotal =
    typeof pricing.subtotal === "number"
      ? pricing.subtotal
      : typeof order?.valorTotalPedido === "number"
        ? order.valorTotalPedido
        : 0;
  const serviceFee = typeof pricing.serviceFee === "number" ? pricing.serviceFee : 0.99;
  const totalToCollect =
    typeof pricing.totalToCollect === "number"
      ? pricing.totalToCollect
      : Math.round((subtotal + serviceFee) * 100) / 100;

  const itens = safeString(order?.itensDescricao ?? "", 4000)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const receiptUrl =
    `${req.protocol}://${req.get("host")}${req.path}` +
    `?orderId=${encodeURIComponent(orderId)}&printKey=${encodeURIComponent(printKey)}&paper=${paper}`;

  const html = buildReceiptHtml({
    paper,
    publicCode: safeString(order?.publicCode ?? `Pedido Dudu_${orderId}`, 120),
    depositoNome,
    createdAtMs: (() => {
      const ts = order?.createdAt;
      if (typeof ts?.toMillis === "function") return ts.toMillis();
      if (typeof ts?.seconds === "number") return ts.seconds * 1000;
      if (typeof ts === "number") return ts;
      return Date.now();
    })(),
    clienteNome: safeString(order?.publicClientName ?? "", 120),
    clienteWaId: safeString(order?.publicWaId ?? order?.userId ?? "", 40),
    endereco: safeString(order?.enderecoEntrega ?? "", 220),
    bairro: safeString(order?.bairro ?? "", 80),
    referencia: safeString(order?.referenciaEntrega ?? "", 120),
    itens,
    subtotal,
    serviceFee,
    totalToCollect,
    receiptUrl,
  });

  try {
    await logEvent({
      tenantCnpj,
      eventName: "RECEIPT_RENDERED",
      orderId,
      userId: order?.userId ?? null,
      depositoId: order?.depositoId ?? null,
      payload: { paper },
    });
  } catch {
    // ignore
  }

  logger.info("Receipt rendered", { orderId, paper });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
