// functions/src/robo/robo.ts
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "../infra/config/firebase";
import { depositosCol, issuesCol, ordersCol, pingInterestsCol, promoHistoryCol } from "../infra/firestore/duduPaths";
import { getDepositoById, listarDepositosAbertosPorBairro, resolveDepositoHorario } from "../modules/depositos/depositoService";
import { isFeatureEnabled } from "../infra/config/featureFlags";
import type { DepositoQualidadeStatus } from "../modules/common/types";
import { rewritePromoText } from "../infra/ai/gemini";
import {
  addRiskFlag,
  strikeDepositoHard,
  touchLastAction,
  updateOrderStatus,
} from "../modules/orders/orderService";
import { sendWhatsAppButtonsMessage, sendWhatsAppTextMessage } from "../modules/whatsapp/send";
import { logEvent } from "../infra/obs/eventLogService";

const SINGLE_TENANT_KEY =
  process.env.SINGLE_TENANT_KEY ?? process.env.SINGLE_TENANT_CNPJ ?? "app";

// thresholds (MVP)
const ISSUES_7D_OBS = Number(process.env.ISSUES_7D_OBS ?? "3");
const ISSUES_7D_SUSP = Number(process.env.ISSUES_7D_SUSP ?? "6");
const LOWRATING_7D_OBS = Number(process.env.LOWRATING_7D_OBS ?? "3");
const LOWRATING_7D_SUSP = Number(process.env.LOWRATING_7D_SUSP ?? "6");

// hard guard thresholds (minutos)
const ACCEPTED_NO_VALOR_PING_MIN = Number(
  process.env.ACCEPTED_NO_VALOR_PING_MIN ?? "7",
);
const ACCEPTED_NO_VALOR_CANCEL_MIN = Number(
  process.env.ACCEPTED_NO_VALOR_CANCEL_MIN ?? "15",
);
const VALOR_NO_CONFIRM_CANCEL_MIN = Number(
  process.env.VALOR_NO_CONFIRM_CANCEL_MIN ?? "20",
);
const A_CAMINHO_NO_UPDATE_PING_MIN = Number(
  process.env.A_CAMINHO_NO_UPDATE_PING_MIN ?? "45",
);
const ISSUE_STALE_PING_MIN = Number(process.env.ISSUE_STALE_PING_MIN ?? "60");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PING_ME_CHECK_COOLDOWN_MS = Number(process.env.PING_ME_CHECK_COOLDOWN_MS ?? "300000");
const PROMO_WINDOW_DAYS = Number(process.env.PROMO_INTELIGENTE_WINDOW_DAYS ?? "15");
const PROMO_THRESHOLD = Number(process.env.PROMO_INTELIGENTE_THRESHOLD ?? "3");
const PROMO_COOLDOWN_DAYS = Number(process.env.PROMO_INTELIGENTE_COOLDOWN_DAYS ?? "15");
const PROMO_PRODUCT_COOLDOWN_DAYS = Number(process.env.PROMO_INTELIGENTE_PRODUCT_COOLDOWN_DAYS ?? "30");
const PROMO_PERCENT_OFF = Number(process.env.PROMO_INTELIGENTE_PERCENT_OFF ?? "15");
const PROMO_MAX_DISCOUNT_CENTAVOS = Number(process.env.PROMO_INTELIGENTE_MAX_DISCOUNT_CENTAVOS ?? "800");
const PROMO_SAFE_WINDOW_START = process.env.PROMO_INTELIGENTE_SAFE_START ?? "10:00";
const PROMO_SAFE_WINDOW_END = process.env.PROMO_INTELIGENTE_SAFE_END ?? "18:00";
const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function tenantCollections(tenantId: string) {
  return {
    firestore: ordersCol(tenantId).firestore,
    orders: ordersCol(tenantId),
    issues: issuesCol(tenantId),
    depositos: depositosCol(tenantId),
    promoHistory: promoHistoryCol(tenantId),
    pingInterests: pingInterestsCol(tenantId),
  };
}

function buildPromoSuggestions(stats: {
  ordersAcceptedCount: number;
  acceptToValorAvgMin: number | null;
  issueCount: number;
  lowRatingCount: number;
}): string[] {
  const out: string[] = [];
  if (stats.ordersAcceptedCount <= 8) {
    out.push("Sugestao: combo leve 2 (ex: 2 cervejas + gelo).");
    out.push("Sugestao: frete gratis acima de R$ 30.");
  }
  if (stats.acceptToValorAvgMin != null && stats.acceptToValorAvgMin >= 10) {
    out.push("Sugestao: cardapio fixo com 3 combos rapidos para acelerar valor.");
  }
  if (stats.issueCount >= 2 || stats.lowRatingCount >= 2) {
    out.push("Sugestao: reforcar conferencia e brinde simples em horario fraco.");
  }
  if (!out.length) {
    out.push("Sugestao: testar brinde pequeno em horario fraco para puxar volume.");
  }
  return out.slice(0, 2);
}

async function renderPromoText(params: {
  depositoNome: string;
  suggestions: string[];
  statsText: string;
}): Promise<string> {
  const base =
    `Dudu Promocao Inteligente - ${params.depositoNome}\n` +
    `${params.statsText}\n` +
    params.suggestions.map((s) => `- ${s}`).join("\n");

  try {
    const msg = await rewritePromoText(base);
    return msg || base;
  } catch (error) {
    logger.error("PROMO_TEXT_REWRITE_FAIL", { error: String(error) });
    return base;
  }
}

function normalizeProductName(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimeToMinutes(raw: any): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})(?::|h)?(\d{2})?/i);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? "0");
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getLocalMinutes(nowMs: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    const d = new Date(nowMs);
    return d.getHours() * 60 + d.getMinutes();
  }
}

function isWithinSafeWindow(nowMs: number, tz: string, fallbackStart: string, fallbackEnd: string): boolean {
  const startMin = parseTimeToMinutes(fallbackStart);
  const endMin = parseTimeToMinutes(fallbackEnd);
  if (startMin == null || endMin == null) return true;
  const nowMin = getLocalMinutes(nowMs, tz);
  if (startMin === endMin) return true;
  if (endMin > startMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

function buildPromoSuggestionText(params: {
  depositoNome: string;
  productName: string;
  count: number;
  percentOff: number;
  maxDiscountCentavos: number;
}): string {
  const product = params.productName
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  const maxBr = `R$ ${(params.maxDiscountCentavos / 100).toFixed(2).replace(".", ",")}`;
  return (
    `Promoção Inteligente - ${params.depositoNome}\n` +
    `Nos últimos ${PROMO_WINDOW_DAYS} dias, "${product}" apareceu ${params.count}x.\n` +
    `Sugestão: ${params.percentOff}% off em ${product} até ${maxBr}.\n` +
    "Se topar, responde: \"Quero entrar na Promoção Inteligente\"."
  );
}

// -----------------------
// Daily rollup: last 7d
// -----------------------
export async function runRoboDailyDepositoRollup(): Promise<void> {
    if (!isFeatureEnabled("FEATURE_ROBO_DAILY_ENABLED", true)) return;

    const tenantCnpj = SINGLE_TENANT_KEY;

    const appRef = tenantCollections(tenantCnpj);
    const now = Date.now();
    const from7d = admin.firestore.Timestamp.fromMillis(
      now - 7 * 24 * 60 * 60 * 1000,
    );

    const ordersSnap = await appRef.orders
      .where("acceptedAt", ">=", from7d)
      .limit(800)
      .get()
      .catch(() => null as any);

    const issuesSnap = await appRef.issues
      .where("createdAt", ">=", from7d)
      .limit(1200)
      .get()
      .catch(() => null as any);

    const perDep: Record<
      string,
      {
        ordersAcceptedCount: number;
        ratingsCount: number;
        goodRatingCount: number;

        nNotifiedToAccept: number;
        sumNotifiedToAcceptMin: number;
        nAcceptToValor: number;
        sumAcceptToValorMin: number;
        issueCount: number;
        lowRatingCount: number;
      }
    > = {};

    const ensure = (id: string) => {
      if (!perDep[id]) {
        perDep[id] = {
          ordersAcceptedCount: 0,
          ratingsCount: 0,
          goodRatingCount: 0,

          nNotifiedToAccept: 0,
          sumNotifiedToAcceptMin: 0,
          nAcceptToValor: 0,
          sumAcceptToValorMin: 0,
          issueCount: 0,
          lowRatingCount: 0,
        };
      }
      return perDep[id];
    };

    if (ordersSnap && !ordersSnap.empty) {
      for (const doc of ordersSnap.docs) {
        const d = doc.data() as any;
        const depositoId = d.depositoId ? String(d.depositoId) : "";
        if (!depositoId) continue;

        const acc = d.acceptedAt?.toMillis?.() ?? null;
        const notif = d.notifiedAt?.toMillis?.() ?? null;
        const valor = d.valorPropostoAt?.toMillis?.() ?? null;

        const s = ensure(depositoId);

        s.ordersAcceptedCount += 1;

        if (acc && notif && acc >= notif) {
          s.nNotifiedToAccept += 1;
          s.sumNotifiedToAcceptMin += (acc - notif) / 60000;
        }

        if (acc && valor && valor >= acc) {
          s.nAcceptToValor += 1;
          s.sumAcceptToValorMin += (valor - acc) / 60000;
        }

        const nota = typeof d.feedbackNota === "number" ? d.feedbackNota : null;
        if (nota != null) {
          s.ratingsCount += 1;
          if (nota >= 4) s.goodRatingCount += 1;
          if (nota <= 2) s.lowRatingCount += 1;
        }
      }
    }

    if (issuesSnap && !issuesSnap.empty) {
      for (const doc of issuesSnap.docs) {
        const d = doc.data() as any;
        const depositoId = d.depositoId ? String(d.depositoId) : "";
        if (!depositoId) continue;
        ensure(depositoId).issueCount += 1;
      }
    }

    const batch = admin.firestore().batch();
    const depSnap = await appRef.depositos
      .limit(500)
      .get()
      .catch(() => null as any);

    if (!depSnap || depSnap.empty) return;

    for (const dep of depSnap.docs) {
      const depId = dep.id;
      const s = perDep[depId] ?? {
        ordersAcceptedCount: 0,
        ratingsCount: 0,
        goodRatingCount: 0,

        nNotifiedToAccept: 0,
        sumNotifiedToAcceptMin: 0,
        nAcceptToValor: 0,
        sumAcceptToValorMin: 0,
        issueCount: 0,
        lowRatingCount: 0,
      };

      const notifiedToAcceptAvgMin =
        s.nNotifiedToAccept > 0
          ? Math.round((s.sumNotifiedToAcceptMin / s.nNotifiedToAccept) * 10) /
            10
          : null;

      const acceptToValorAvgMin =
        s.nAcceptToValor > 0
          ? Math.round((s.sumAcceptToValorMin / s.nAcceptToValor) * 10) / 10
          : null;

      batch.set(
        dep.ref,
        {
          stats: {
            last7d: {
              ordersAcceptedCount: s.ordersAcceptedCount,
              ratingsCount: s.ratingsCount,
              goodRatingCount: s.goodRatingCount,

              notifiedToAcceptAvgMin,
              acceptToValorAvgMin,
              issueCount: s.issueCount,
              lowRatingCount: s.lowRatingCount,
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // qualidade (soft)
      let statusQualidade: DepositoQualidadeStatus = "OK";
      let reason: string | null = null;

      if (
        s.issueCount >= ISSUES_7D_SUSP ||
        s.lowRatingCount >= LOWRATING_7D_SUSP
      ) {
        statusQualidade = "SUSPENSO";
        reason = `auto: issues7d=${s.issueCount}, lowRating7d=${s.lowRatingCount}`;
      } else if (
        s.issueCount >= ISSUES_7D_OBS ||
        s.lowRatingCount >= LOWRATING_7D_OBS
      ) {
        statusQualidade = "EM_OBSERVACAO";
        reason = `auto: issues7d=${s.issueCount}, lowRating7d=${s.lowRatingCount}`;
      }

      if (statusQualidade !== "OK") {
        batch.set(
          dep.ref,
          {
            quality: {
              statusQualidade,
              strikes7d: s.issueCount + s.lowRatingCount,
              reason,
              updatedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    await batch.commit();


    // legacy promo suggestions desligado por default (novo fluxo em roboPromoInteligente)
    if (isFeatureEnabled("FEATURE_PROMO_LEGACY_ENABLED", false)) {
      for (const dep of depSnap.docs) {
        const d = dep.data() as any;
        const depId = dep.id;
        const depStats = perDep[depId] ?? {
          ordersAcceptedCount: 0,
          ratingsCount: 0,
          goodRatingCount: 0,
          nNotifiedToAccept: 0,
          sumNotifiedToAcceptMin: 0,
          nAcceptToValor: 0,
          sumAcceptToValorMin: 0,
          issueCount: 0,
          lowRatingCount: 0,
        };

        const lastPromoAtMs = Number(d?.promoSuggestion?.createdAtMs ?? 0);
        if (lastPromoAtMs && now - lastPromoAtMs < WEEK_MS) continue;

        const suggestions = buildPromoSuggestions({
          ordersAcceptedCount: depStats.ordersAcceptedCount,
          acceptToValorAvgMin:
            depStats.nAcceptToValor > 0
              ? Math.round((depStats.sumAcceptToValorMin / depStats.nAcceptToValor) * 10) / 10
              : null,
          issueCount: depStats.issueCount,
          lowRatingCount: depStats.lowRatingCount,
        });

        const notifiedToAcceptAvgMin =
          depStats.nNotifiedToAccept > 0
            ? Math.round((depStats.sumNotifiedToAcceptMin / depStats.nNotifiedToAccept) * 10) / 10
            : null;
        const acceptToValorAvgMin =
          depStats.nAcceptToValor > 0
            ? Math.round((depStats.sumAcceptToValorMin / depStats.nAcceptToValor) * 10) / 10
            : null;

        const statsText =
          `Resumo 7d: pedidos=${depStats.ordersAcceptedCount}, issues=${depStats.issueCount}, ` +
          `notas boas=${depStats.goodRatingCount}/${depStats.ratingsCount}, ` +
          `notif->aceito=${notifiedToAcceptAvgMin ?? "n/d"}m, ` +
          `aceito->valor=${acceptToValorAvgMin ?? "n/d"}m.`;

        const promoText = await renderPromoText({
          depositoNome: String(d?.nome ?? "Deposito"),
          suggestions,
          statsText,
        });

        const promoPayload = {
          promoSuggestion: {
            text: promoText.slice(0, 600),
            suggestions,
            createdAt: FieldValue.serverTimestamp(),
            createdAtMs: now,
            expiresAt: admin.firestore.Timestamp.fromMillis(now + WEEK_MS),
            statsSnapshot: {
              ordersAcceptedCount: depStats.ordersAcceptedCount,
              issueCount: depStats.issueCount,
              lowRatingCount: depStats.lowRatingCount,
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
        };

        await dep.ref.set(promoPayload, { merge: true }).catch(() => void 0);

        const phoneNumberId = String(d?.phoneNumberId ?? "").trim();
        const waId = String(d?.waId ?? "").trim();
        let sent = false;
        if (phoneNumberId && waId) {
          await sendWhatsAppTextMessage({
            tenantCnpj,
            phoneNumberId,
            to: waId,
            body: promoText,
          })
            .then(() => {
              sent = true;
            })
            .catch(() => void 0);

          if (sent) {
            await dep.ref.set(
              { promoSuggestion: { sentAt: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() },
              { merge: true },
            ).catch(() => void 0);
          }
        }

        await logEvent({
          tenantCnpj,
          eventName: "ROBO_PROMO_SUGGESTION",
          depositoId: depId,
          payload: {
            sent,
            suggestions,
            createdAtMs: now,
          },
        }).catch(() => void 0);
      }
    }

    logger.info("Robô daily rollup concluído", {
      tenantCnpj,
      depositos: depSnap.size,
      orders: ordersSnap?.size ?? 0,
      issues: issuesSnap?.size ?? 0,
    });
}

// -----------------------
// Promoção Inteligente (quinzenal, opt-in)
// -----------------------
export async function runRoboPromoInteligente(): Promise<void> {
    if (!isFeatureEnabled("FEATURE_PROMO_INTELIGENTE_ENABLED", true)) return;

    const tenantCnpj = SINGLE_TENANT_KEY;

    const appRef = tenantCollections(tenantCnpj);
    const now = Date.now();
    const from15d = admin.firestore.Timestamp.fromMillis(
      now - PROMO_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const depSnap = await appRef.depositos
      .where("promocaoInteligente.enabled", "==", true)
      .limit(200)
      .get()
      .catch(() => null as any);

    if (!depSnap || depSnap.empty) return;

    for (const dep of depSnap.docs) {
      const d = dep.data() as any;
      const promo = d?.promocaoInteligente ?? {};
      const lastInviteAtMs = Number(promo?.lastInviteAtMs ?? 0);
      const cooldownMs = PROMO_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      if (lastInviteAtMs && now - lastInviteAtMs < cooldownMs) continue;

      const tz = String(d?.timezone ?? DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;
      const horario = resolveDepositoHorario({ data: d, nowMs: now });
      const withinWindow = horario.scheduleFound
        ? horario.open
        : isWithinSafeWindow(now, tz, PROMO_SAFE_WINDOW_START, PROMO_SAFE_WINDOW_END);

      const pendingProductName = normalizeProductName(promo?.pendingProductName ?? "");
      const pendingCount = Number(promo?.pendingCount ?? 0);
      const pendingOrderId = String(promo?.pendingOrderId ?? "");

      if (pendingProductName) {
        if (!withinWindow) continue;

        const phoneNumberId = String(d?.phoneNumberId ?? "").trim();
        const waId = String(d?.waId ?? "").trim();
        if (!phoneNumberId || !waId) continue;

        const text = buildPromoSuggestionText({
          depositoNome: String(d?.nome ?? "Deposito"),
          productName: pendingProductName,
          count: pendingCount || PROMO_THRESHOLD,
          percentOff: PROMO_PERCENT_OFF,
          maxDiscountCentavos: PROMO_MAX_DISCOUNT_CENTAVOS,
        });

        await sendWhatsAppTextMessage({
          tenantCnpj,
          phoneNumberId,
          to: waId,
          body: text,
        }).catch(() => void 0);

        const windowStart = admin.firestore.Timestamp.fromMillis(now);
        const windowEnd = admin.firestore.Timestamp.fromMillis(
          now + PROMO_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );

        if (pendingOrderId) {
          await appRef.orders.doc(pendingOrderId).set(
            {
              promoDiscountCandidate: {
                enabledByDeposito: true,
                productName: pendingProductName,
                percentOff: PROMO_PERCENT_OFF,
                maxDiscountCentavos: PROMO_MAX_DISCOUNT_CENTAVOS,
                windowStart,
                windowEnd,
                notes: "Custo do deposito (promoção inteligente)",
              },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          ).catch(() => void 0);
        }

        const productCooldowns = promo?.productCooldowns ?? {};
        productCooldowns[pendingProductName] = now;

        await dep.ref.set(
          {
            promocaoInteligente: {
              ...promo,
              lastInviteAt: FieldValue.serverTimestamp(),
              lastInviteAtMs: now,
              lastInviteProductName: pendingProductName,
              pendingInviteAt: null,
              pendingInviteAtMs: null,
              pendingProductName: null,
              pendingCount: null,
              pendingOrderId: null,
              productCooldowns,
              updatedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ).catch(() => void 0);

        await logEvent({
          tenantCnpj,
          eventName: "PROMO_INTELIGENTE_INVITE_SENT",
          depositoId: dep.id,
          payload: { productName: pendingProductName, count: pendingCount },
        }).catch(() => void 0);

        continue;
      }

      const historySnap = await appRef.promoHistory
        .where("depositoId", "==", dep.id)
        .where("concludedAt", ">=", from15d)
        .orderBy("concludedAt", "desc")
        .limit(500)
        .get()
        .catch(() => null as any);

      if (!historySnap || historySnap.empty) continue;

      const counts: Record<string, number> = {};
      const lastOrder: Record<string, { orderId: string; concludedAtMs: number }> = {};
      for (const doc of historySnap.docs) {
        const h = doc.data() as any;
        const name = normalizeProductName(h?.productName ?? "");
        if (!name) continue;
        counts[name] = (counts[name] ?? 0) + Number(h?.quantity ?? 1);
        const concludedAtMs = h?.concludedAt?.toMillis?.() ?? 0;
        if (!lastOrder[name] || concludedAtMs > lastOrder[name].concludedAtMs) {
          lastOrder[name] = { orderId: String(h?.orderId ?? ""), concludedAtMs };
        }
      }

      const productCooldowns = promo?.productCooldowns ?? {};
      let selected: { productName: string; count: number; orderId: string } | null = null;

      for (const [productName, count] of Object.entries(counts)) {
        if (count < PROMO_THRESHOLD) continue;
        const lastAtMs = Number(productCooldowns[productName] ?? 0);
        if (lastAtMs && now - lastAtMs < PROMO_PRODUCT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) continue;
        const candidate = {
          productName,
          count,
          orderId: lastOrder[productName]?.orderId ?? "",
        };
        if (!selected || candidate.count > selected.count) selected = candidate;
      }

      if (!selected) continue;

      if (!withinWindow) {
        if (!promo?.pendingInviteAtMs) {
          await dep.ref.set(
            {
              promocaoInteligente: {
                ...promo,
                pendingInviteAt: FieldValue.serverTimestamp(),
                pendingInviteAtMs: now,
                pendingProductName: selected.productName,
                pendingCount: selected.count,
                pendingOrderId: selected.orderId || null,
                updatedAt: FieldValue.serverTimestamp(),
              },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          ).catch(() => void 0);
        }
        continue;
      }

      const phoneNumberId = String(d?.phoneNumberId ?? "").trim();
      const waId = String(d?.waId ?? "").trim();
      if (!phoneNumberId || !waId) continue;

      const text = buildPromoSuggestionText({
        depositoNome: String(d?.nome ?? "Deposito"),
        productName: selected.productName,
        count: selected.count,
        percentOff: PROMO_PERCENT_OFF,
        maxDiscountCentavos: PROMO_MAX_DISCOUNT_CENTAVOS,
      });

      await sendWhatsAppTextMessage({
        tenantCnpj,
        phoneNumberId,
        to: waId,
        body: text,
      }).catch(() => void 0);

      const windowStart = admin.firestore.Timestamp.fromMillis(now);
      const windowEnd = admin.firestore.Timestamp.fromMillis(
        now + PROMO_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );

      if (selected.orderId) {
        await appRef.orders.doc(selected.orderId).set(
          {
            promoDiscountCandidate: {
              enabledByDeposito: true,
              productName: selected.productName,
              percentOff: PROMO_PERCENT_OFF,
              maxDiscountCentavos: PROMO_MAX_DISCOUNT_CENTAVOS,
              windowStart,
              windowEnd,
              notes: "Custo do deposito (promoção inteligente)",
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ).catch(() => void 0);
      }

      productCooldowns[selected.productName] = now;

      await dep.ref.set(
        {
          promocaoInteligente: {
            ...promo,
            lastInviteAt: FieldValue.serverTimestamp(),
            lastInviteAtMs: now,
            lastInviteProductName: selected.productName,
            pendingInviteAt: null,
            pendingInviteAtMs: null,
            pendingProductName: null,
            pendingCount: null,
            pendingOrderId: null,
            productCooldowns,
            updatedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ).catch(() => void 0);

      await logEvent({
        tenantCnpj,
        eventName: "PROMO_INTELIGENTE_INVITE_SENT",
        depositoId: dep.id,
        payload: { productName: selected.productName, count: selected.count },
      }).catch(() => void 0);
    }
}

// -----------------------
// Ops Guard (hard) - 5 min
// -----------------------
export async function runRoboOpsGuard(): Promise<void> {
    if (!isFeatureEnabled("FEATURE_ROBO_OPS_GUARD_ENABLED", true)) return;

    const tenantCnpj = SINGLE_TENANT_KEY;

    const appRef = tenantCollections(tenantCnpj);
    const ordersRef = appRef.orders;
    const issuesRef = appRef.issues;

    const now = Date.now();
    const acceptedNoValorPingAt = admin.firestore.Timestamp.fromMillis(
      now - ACCEPTED_NO_VALOR_PING_MIN * 60 * 1000,
    );
    const acceptedNoValorCancelAt = admin.firestore.Timestamp.fromMillis(
      now - ACCEPTED_NO_VALOR_CANCEL_MIN * 60 * 1000,
    );
    const valorNoConfirmCancelAt = admin.firestore.Timestamp.fromMillis(
      now - VALOR_NO_CONFIRM_CANCEL_MIN * 60 * 1000,
    );
    const aCaminhoNoUpdatePingAt = admin.firestore.Timestamp.fromMillis(
      now - A_CAMINHO_NO_UPDATE_PING_MIN * 60 * 1000,
    );
    const issueStaleAt = admin.firestore.Timestamp.fromMillis(
      now - ISSUE_STALE_PING_MIN * 60 * 1000,
    );

    // ---------------------------------------------------
    // 1) ACCEPTED sem valor: ping 1x em 7min
    // ---------------------------------------------------
    const snapPingNoValor = await ordersRef
      .where("status", "==", "ACCEPTED")
      .where("acceptedAt", "<=", acceptedNoValorPingAt)
      .limit(60)
      .get()
      .catch(() => null as any);

    if (snapPingNoValor && !snapPingNoValor.empty) {
      for (const doc of snapPingNoValor.docs) {
        const d = doc.data() as any;
        if (d.valorPropostoAt) continue;

        const already = d?.reminders?.acceptedNoValorPingAt ?? null;
        if (already) continue;

        const depositoId = d.depositoId ? String(d.depositoId) : null;
        const phoneNumberId = String(d.phoneNumberId ?? "");
        const userId = String(d.userId ?? "");
        if (!depositoId || !phoneNumberId || !userId) continue;

        const deposito = await getDepositoById(tenantCnpj, depositoId);
        if (!deposito) continue;

        await doc.ref.set(
          {
            reminders: {
              ...(d.reminders ?? {}),
              acceptedNoValorPingAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        await addRiskFlag({
          tenantCnpj,
          orderId: doc.id,
          flag: "DEPOSITO_LENTO",
        }).catch(() => void 0);

        await sendWhatsAppTextMessage({
          tenantCnpj,
          phoneNumberId,
          to: deposito.waId,
          orderId: doc.id,
          body:
            "Ops Dudu: tu aceitou um pedido e ainda não mandou o valor.\n" +
            "Manda assim: 'deu 35' ou 'valor 29,90'.\n" +
            "Se não puder atender, responde 'recusar' pra eu rerotear.",
        }).catch(() => void 0);

        await logEvent({
          tenantCnpj,
          eventName: "ROBO_PING_ACCEPTED_NO_VALOR",
          orderId: doc.id,
          userId,
          depositoId,
        }).catch(() => void 0);

        await touchLastAction({
          tenantCnpj,
          orderId: doc.id,
          by: "system",
          textPreview: "robo_ping_no_valor",
        }).catch(() => void 0);
      }
    }

    // ---------------------------------------------------
    // 2) ACCEPTED sem valor: cancela hard em 15min
    // ---------------------------------------------------
    const snapCancelNoValor = await ordersRef
      .where("status", "==", "ACCEPTED")
      .where("acceptedAt", "<=", acceptedNoValorCancelAt)
      .limit(60)
      .get()
      .catch(() => null as any);

    if (snapCancelNoValor && !snapCancelNoValor.empty) {
      for (const doc of snapCancelNoValor.docs) {
        const d = doc.data() as any;
        if (d.valorPropostoAt) continue;

        const depositoId = d.depositoId ? String(d.depositoId) : null;
        const phoneNumberId = String(d.phoneNumberId ?? "");
        const userId = String(d.userId ?? "");
        if (!depositoId || !phoneNumberId || !userId) continue;

        await updateOrderStatus({
          tenantCnpj,
          orderId: doc.id,
          newStatus: "CANCELED",
          extraFields: {
            cancelReason: "AUTO:ACCEPTED_NO_VALOR",
            updatedAt: FieldValue.serverTimestamp(),
          },
        }).catch(() => void 0);

        await strikeDepositoHard({
          tenantCnpj,
          depositoId,
          kind: "NO_VALOR",
          reason: "aceitou e nao mandou valor (15min)",
        }).catch(() => void 0);

        const deposito = await getDepositoById(tenantCnpj, depositoId);
        if (deposito) {
          await sendWhatsAppTextMessage({
            tenantCnpj,
            phoneNumberId,
            to: deposito.waId,
            orderId: doc.id,
            body:
              "Ops Dudu: cancelei o pedido automaticamente porque passou muito tempo sem valor.\n" +
              "Isso protege tua reputação e a do Dudu. No próximo, manda o valor rápido.",
          }).catch(() => void 0);
        }

        await sendWhatsAppTextMessage({
          tenantCnpj,
          phoneNumberId,
          to: userId,
          orderId: doc.id,
          body:
            "Rapaz… eu cancelei esse pedido porque o depósito aceitou e não mandou valor a tempo.\n" +
            "Se quiser tentar de novo, manda teu pedido novamente que eu puxo outro depósito.",
        }).catch(() => void 0);

        await logEvent({
          tenantCnpj,
          eventName: "ROBO_CANCEL_ACCEPTED_NO_VALOR",
          orderId: doc.id,
          userId,
          depositoId,
        }).catch(() => void 0);
      }
    }

    // ---------------------------------------------------
    // 3) Valor proposto sem confirmação: cancela hard em 20min
    // ---------------------------------------------------
    const snapValorNoConfirm = await ordersRef
      .where("status", "==", "ACCEPTED")
      .where("valorPropostoAt", "<=", valorNoConfirmCancelAt)
      .limit(60)
      .get()
      .catch(() => null as any);

    if (snapValorNoConfirm && !snapValorNoConfirm.empty) {
      for (const doc of snapValorNoConfirm.docs) {
        const d = doc.data() as any;
        if (!d.valorPropostoAt) continue;
        if (d.valorConfirmadoAt) continue;
        if (d.valorRejeitadoAt) continue;

        const phoneNumberId = String(d.phoneNumberId ?? "");
        const userId = String(d.userId ?? "");
        const depositoId = d.depositoId ? String(d.depositoId) : null;
        if (!phoneNumberId || !userId) continue;

        await updateOrderStatus({
          tenantCnpj,
          orderId: doc.id,
          newStatus: "CANCELED",
          extraFields: {
            cancelReason: "AUTO:CLIENT_NO_CONFIRM_VALOR",
            updatedAt: FieldValue.serverTimestamp(),
          },
        }).catch(() => void 0);

        if (depositoId) {
          const deposito = await getDepositoById(tenantCnpj, depositoId);
          if (deposito) {
            await sendWhatsAppTextMessage({
              tenantCnpj,
              phoneNumberId,
              to: deposito.waId,
              orderId: doc.id,
              body:
                "Ops Dudu: cancelei o pedido porque o cliente não confirmou o valor a tempo.\n" +
                "Se quiser reduzir valor pra fechar mais rápido, manda o valor novo quando acontecer.",
            }).catch(() => void 0);
          }
        }

        await sendWhatsAppTextMessage({
          tenantCnpj,
          phoneNumberId,
          to: userId,
          orderId: doc.id,
          body:
            "Fechou. Esse pedido foi cancelado porque o valor não foi confirmado a tempo.\n" +
            "Se quiser, manda teu pedido de novo que eu refaço rapidinho.",
        }).catch(() => void 0);

        await logEvent({
          tenantCnpj,
          eventName: "ROBO_CANCEL_NO_CONFIRM_VALOR",
          orderId: doc.id,
          userId,
          depositoId: depositoId ?? null,
        }).catch(() => void 0);
      }
    }

    // ---------------------------------------------------
    // 4) A_CAMINHO sem update: ping depósito 1x (45min)
    // ---------------------------------------------------
    const snapACaminho = await ordersRef
      .where("status", "==", "ACCEPTED")
      .where("fulfillmentStatus", "==", "A_CAMINHO" as any)
      .where("updatedAt", "<=", aCaminhoNoUpdatePingAt)
      .limit(60)
      .get()
      .catch(() => null as any);

    if (snapACaminho && !snapACaminho.empty) {
      for (const doc of snapACaminho.docs) {
        const d = doc.data() as any;

        const already = d?.reminders?.aCaminhoPingAt ?? null;
        if (already) continue;

        const depositoId = d.depositoId ? String(d.depositoId) : null;
        const phoneNumberId = String(d.phoneNumberId ?? "");
        const userId = String(d.userId ?? "");
        if (!depositoId || !phoneNumberId || !userId) continue;

        const deposito = await getDepositoById(tenantCnpj, depositoId);
        if (!deposito) continue;

        await doc.ref.set(
          {
            reminders: {
              ...(d.reminders ?? {}),
              aCaminhoPingAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        await addRiskFlag({
          tenantCnpj,
          orderId: doc.id,
          flag: "DEPOSITO_LENTO",
        }).catch(() => void 0);
        await strikeDepositoHard({
          tenantCnpj,
          depositoId,
          kind: "NO_UPDATE",
          reason: "A_CAMINHO sem update 45min",
        }).catch(() => void 0);

        await sendWhatsAppTextMessage({
          tenantCnpj,
          phoneNumberId,
          to: deposito.waId,
          orderId: doc.id,
          body:
            "Ops Dudu: esse pedido tá 'A CAMINHO' há tempo demais sem atualização.\n" +
            "Se já entregou, manda 'entregue'. Se deu BO, responde o motivo agora.",
        }).catch(() => void 0);

        await sendWhatsAppTextMessage({
          tenantCnpj,
          phoneNumberId,
          to: userId,
          orderId: doc.id,
          body:
            "Meu rei, tô cobrando o depósito aqui porque tá demorando mais do que o normal.\n" +
            "Se não chegou ainda, responde: 'não chegou'.",
        }).catch(() => void 0);

        await logEvent({
          tenantCnpj,
          eventName: "ROBO_PING_A_CAMINHO_STALE",
          orderId: doc.id,
          userId,
          depositoId,
        }).catch(() => void 0);
      }
    }

    // ---------------------------------------------------
    // 5) Issue OPEN velha: ping depósito 1x + strike hard
    // ---------------------------------------------------
    const snapIssues = await issuesRef
      .where("status", "in", ["OPEN", "IN_PROGRESS"] as any)
      .where("createdAt", "<=", issueStaleAt)
      .limit(60)
      .get()
      .catch(() => null as any);

    if (snapIssues && !snapIssues.empty) {
      for (const issueDoc of snapIssues.docs) {
        const d = issueDoc.data() as any;
        const depositoId = d.depositoId ? String(d.depositoId) : null;
        const orderId = String(d.orderId ?? "");
        const userId = String(d.userId ?? "");
        if (!depositoId || !orderId) continue;

        const pingAt = d?.reminders?.pingAt ?? null;
        if (pingAt) continue;

        const orderSnap = await ordersRef
          .doc(orderId)
          .get()
          .catch(() => null as any);
        const phoneNumberId = orderSnap?.exists
          ? String(orderSnap.data()?.phoneNumberId ?? "")
          : "";
        if (!phoneNumberId) continue;

        const deposito = await getDepositoById(tenantCnpj, depositoId);
        if (!deposito) continue;

        await issueDoc.ref.set(
          {
            reminders: { pingAt: FieldValue.serverTimestamp() },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        await strikeDepositoHard({
          tenantCnpj,
          depositoId,
          kind: "ISSUE_STALE",
          reason: `issue velha >=${ISSUE_STALE_PING_MIN}min`,
        }).catch(() => void 0);

        await sendWhatsAppTextMessage({
          tenantCnpj,
          phoneNumberId,
          to: deposito.waId,
          orderId,
          body:
            "Ops Dudu: tem uma reclamação/BO pendente de cliente e tu não respondeu.\n" +
            "Responde aqui com: 'resolvido' e o que foi feito (ou explica o ocorrido).",
        }).catch(() => void 0);

        await logEvent({
          tenantCnpj,
          eventName: "ROBO_PING_ISSUE_STALE",
          orderId,
          userId,
          depositoId,
          payload: { issueId: issueDoc.id, issueType: d.type ?? null },
        }).catch(() => void 0);
      }
    }

    // ---------------------------------------------------
    // 6) Ping me quando abrir (opt-in do cliente)
    // ---------------------------------------------------
    if (isFeatureEnabled("FEATURE_PING_ME_ENABLED", true)) {
      const pingSnap = await appRef.pingInterests
        .where("status", "==", "OPEN")
        .limit(40)
        .get()
        .catch(() => null as any);

      if (pingSnap && !pingSnap.empty) {
        for (const doc of pingSnap.docs) {
          const d = doc.data() as any;
          const nowMs = Date.now();
          const expiresAtMs = Number(d?.expiresAtMs ?? 0);
          if (expiresAtMs && expiresAtMs < nowMs) {
            await doc.ref.set(
              { status: "EXPIRED", updatedAt: FieldValue.serverTimestamp() },
              { merge: true },
            ).catch(() => void 0);
            continue;
          }

          const lastCheckedAtMs = Number(d?.lastCheckedAtMs ?? 0);
          if (lastCheckedAtMs && nowMs - lastCheckedAtMs < PING_ME_CHECK_COOLDOWN_MS) {
            continue;
          }

          const bairro = String(d?.bairro ?? "").trim();
          const canal = String(d?.canal ?? "").trim();
          const waId = String(d?.waId ?? "").trim();
          const phoneNumberId = String(d?.phoneNumberId ?? "").trim();
          if (!bairro || !canal || !waId || !phoneNumberId) {
            await doc.ref.set(
              { status: "INVALID", updatedAt: FieldValue.serverTimestamp() },
              { merge: true },
            ).catch(() => void 0);
            continue;
          }

          await doc.ref.set(
            { lastCheckedAtMs: nowMs, lastCheckedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          ).catch(() => void 0);

          const depositos = await listarDepositosAbertosPorBairro(tenantCnpj, bairro);
          const has =
            canal === "RETIRADA"
              ? depositos.some((dep: { retiradaDisponivel?: boolean }) => dep.retiradaDisponivel)
              : depositos.some((dep: { deliveryDisponivel?: boolean }) => dep.deliveryDisponivel);

          if (!has) continue;

          await sendWhatsAppButtonsMessage({
            tenantCnpj,
            phoneNumberId,
            to: waId,
            body: `Tem deposito aberto em ${bairro} para ${canal}. Quer pedir agora?`,
            buttons: [
              { id: "PEDIR_DE_NOVO", title: "Pedir agora" },
              { id: "STATUS", title: "Status" },
            ],
          }).catch(() => void 0);

          await doc.ref.set(
            {
              status: "NOTIFIED",
              notifiedAt: FieldValue.serverTimestamp(),
              notifiedAtMs: nowMs,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          ).catch(() => void 0);

          await logEvent({
            tenantCnpj,
            eventName: "PING_ME_NOTIFY",
            userId: waId,
            payload: { bairro, canal },
          }).catch(() => void 0);
        }
      }
    }
}


