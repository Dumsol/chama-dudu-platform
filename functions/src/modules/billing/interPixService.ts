import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { readInterPixKey } from "../../infra/config/secrets";
import { interRequestJson } from "./interClient";

function isAbsUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function joinUrl(base: string, pathOrUrl: string): string {
  if (isAbsUrl(pathOrUrl)) return pathOrUrl.replace(/\/+$/, "");
  const b = base.replace(/\/+$/, "");
  const p = String(pathOrUrl ?? "").replace(/^\/+/, "");
  return `${b}/${p}`.replace(/\/+$/, "");
}

function centsToReaisString(cents: number): string {
  const v = Math.max(0, Math.round(Number(cents) || 0));
  const reais = (v / 100).toFixed(2);
  return reais.replace(".", ".");
}

function parseBRLToCentavos(raw: any): number | null {
  if (raw == null) return null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // se veio em reais
    return Math.round(raw * 100);
  }

  const s = String(raw).trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function parseIsoToTs(iso: any): admin.firestore.Timestamp | null {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return admin.firestore.Timestamp.fromMillis(ms);
}

function isCobPaidStatus(status: any): boolean {
  const s = String(status ?? "").toUpperCase().trim();
  return s === "CONCLUIDA" || s === "LIQUIDADA" || s === "LIQUIDADO" || s === "PAGO";
}

// txid Pix: máximo 35 chars, [a-zA-Z0-9]
// você já usa makeStableTxidFromCycleId; mantenho regra limpa e determinística.
export function makeStableTxidFromCycleId(cycleId: string): string {
  const base = String(cycleId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 30);

  const suffix = String(cycleId ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-5)
    .toLowerCase();

  const txid = `${base}${suffix}`.slice(0, 35);
  return txid || "chamadudu";
}

export async function createCobPix(params: {
  txid: string;
  valorCentavos: number;
  expiracaoSegundos: number;
  solicitacaoPagador?: string;
}): Promise<{
  txid: string;
  brcode: string;
  qrCodeBase64?: string | null;
}> {
  const txid = String(params.txid ?? "").trim();
  if (!txid) throw new Error("createCobPix: txid obrigatório");

  const pixKey = readInterPixKey().trim();
  if (!pixKey) throw new Error("createCobPix: INTER_PIX_KEY vazio");

  const scope = (process.env.INTER_SCOPE_PIX ?? "").trim() || "cob.write";

  const baseUrl = String(process.env.INTER_BASE_URL ?? "").trim();
  const pixBasePath = String( process.env.INTER_PIX_BASE_PATH ?? "").trim();
  const pixBase = joinUrl(baseUrl, pixBasePath);

  // 1) PUT /cob/{txid}
  const putUrl = `${pixBase}/cob/${encodeURIComponent(txid)}`;

  const body = {
    calendario: { expiracao: Math.max(60, Number(params.expiracaoSegundos ?? 0) || 0) },
    valor: { original: centsToReaisString(params.valorCentavos) },
    chave: pixKey,
    solicitacaoPagador: String(params.solicitacaoPagador ?? "Chama Dudu").slice(0, 140),
  };

  await interRequestJson({
    scope,
    method: "PUT",
    url: putUrl,
    bodyJson: body,
  });

  // 2) GET /cob/{txid}/qrcode
  const qrUrl = `${pixBase}/cob/${encodeURIComponent(txid)}/qrcode`;
  const qrResp = await interRequestJson<any>({
    scope,
    method: "GET",
    url: qrUrl,
  });
  const qr = qrResp.data as any;

  const brcode =
    String(qr?.qrcode ?? qr?.brcode ?? qr?.codigo ?? "").trim();

  const qrCodeBase64 =
    qr?.imagemQrcode
      ? String(qr.imagemQrcode).trim()
      : qr?.imagemQrcodeBase64
        ? String(qr.imagemQrcodeBase64).trim()
        : null;

  if (!brcode) {
    logger.warn("Inter: QRCode sem brcode (txid)", { txid, qrKeys: Object.keys(qr ?? {}) });
  }

  return { txid, brcode, qrCodeBase64 };
}

export async function getCobByTxid(params: {
  txid: string;
}): Promise<{
  ok: boolean;
  paid: boolean;
  status: string | null;
  endToEndId: string | null;
  valorRecebidoCentavos: number | null;
  createdAt: admin.firestore.Timestamp | null;
  expiresAt: admin.firestore.Timestamp | null;
  raw: any | null;
  error?: string;
}> {
  const txid = String(params.txid ?? "").trim();
  if (!txid) {
    return {
      ok: false,
      paid: false,
      status: null,
      endToEndId: null,
      valorRecebidoCentavos: null,
      createdAt: null,
      expiresAt: null,
      raw: null,
      error: "missing_txid",
    };
  }

  const baseUrl = String( process.env.INTER_BASE_URL ?? "").trim();
  const pixBasePath = String(process.env.INTER_PIX_BASE_PATH ?? "").trim();
  const pixBase = joinUrl(baseUrl, pixBasePath);

  const url = `${pixBase}/cob/${encodeURIComponent(txid)}`;

  try {
    // reconcile precisa de leitura. Se você deixar só cob.write, pode dar 403.
    const scope = (process.env.INTER_SCOPE_PIX ?? "").trim() || "cob.read";
    const resp = await interRequestJson<any>({
      scope,
      method: "GET",
      url,
    });
    const cob = resp.data as any;

    const status = String(cob?.status ?? cob?.situacao ?? "").trim() || null;
    const paid = isCobPaidStatus(status);

    const calendario = cob?.calendario ?? {};
    const createdAt = parseIsoToTs(calendario?.criacao) ?? null;

    const expSec = Number(calendario?.expiracao ?? 0);
    const expiresAt =
      createdAt && Number.isFinite(expSec) && expSec > 0
        ? admin.firestore.Timestamp.fromMillis(createdAt.toMillis() + expSec * 1000)
        : null;

    const pixArr = Array.isArray(cob?.pix) ? cob.pix : [];
    const pix0 = pixArr.length ? pixArr[0] : null;

    const endToEndId = pix0?.endToEndId ? String(pix0.endToEndId) : null;

    const valorRecebidoCentavos =
      parseBRLToCentavos(pix0?.valor) ??
      parseBRLToCentavos(cob?.valor?.original ?? cob?.valor) ??
      null;

    return {
      ok: true,
      paid,
      status,
      endToEndId,
      valorRecebidoCentavos,
      createdAt,
      expiresAt,
      raw: cob,
    };
  } catch (err: any) {
    logger.error("Inter getCobByTxid falhou", {
      txid,
      status: err?.response?.status ?? null,
      data: err?.response?.data ?? null,
      error: err?.message ?? String(err),
    });

    return {
      ok: false,
      paid: false,
      status: null,
      endToEndId: null,
      valorRecebidoCentavos: null,
      createdAt: null,
      expiresAt: null,
      raw: null,
      error: err?.message ?? String(err),
    };
  }
}
