import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "../infra/config/firebase";
import { isFeatureEnabled } from "../infra/config/featureFlags";
import { depositosByWaCol, depositosCol, tenantsCol } from "../infra/firestore/duduPaths";
import { normalizeBairro, normalizeWhatsAppId } from "../domain/whatsapp/normalize";
import {
  SEED_TEST_DEPOSITO_CNPJ,
  SEED_TEST_DEPOSITO_DOC_ID,
  SEED_TEST_DEPOSITO_PHONE_RAW,
} from "../domain/seedTestDeposito";

const DEFAULT_REGION = "southamerica-east1";
const SEED_NAME = "Deposito Seed Teste";
const SEED_BAIRRO = "Pau Amarelo";

function normalizeBrazilWaId(rawPhone: string): string {
  const digits = normalizeWhatsAppId(rawPhone);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function resolveTenantId(): Promise<string> {
  const envTenant = String(process.env.SEED_TEST_DEPOSITO_TENANT_ID ?? "").trim();
  if (envTenant) return envTenant;

  const singleTenant = String(
    process.env.SINGLE_TENANT_KEY ?? process.env.SINGLE_TENANT_CNPJ ?? "",
  ).trim();
  if (singleTenant) return singleTenant;

  const firstTenant = await tenantsCol().limit(1).get();
  if (!firstTenant.empty) return firstTenant.docs[0].id;

  return "app";
}

async function ensureTenantDoc(tenantId: string): Promise<void> {
  const ref = tenantsCol().doc(tenantId);
  const snap = await ref.get();
  if (snap.exists) return;
  await ref.set(
    {
      name: `Seed tenant ${tenantId}`,
      seedManaged: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function ensureTenantDeposito(params: {
  tenantId: string;
  waId: string;
  cnpj: string;
  bairroNorm: string;
}): Promise<boolean> {
  const ref = depositosCol(params.tenantId).doc(SEED_TEST_DEPOSITO_DOC_ID);
  const snap = await ref.get();
  if (snap.exists) return false;

  await ref.set(
    {
      nome: SEED_NAME,
      nomeDeposito: SEED_NAME,
      bairro: SEED_BAIRRO,
      bairroNorm: params.bairroNorm,
      waId: params.waId,
      whatsappRaw: SEED_TEST_DEPOSITO_PHONE_RAW,
      status: "FECHADO",
      aberto: false,
      deliveryDisponivel: true,
      retiradaDisponivel: true,
      cnpj: params.cnpj,
      isTestSeed: true,
      billingTestMode: {
        immediateOnFirstConfirmedOrder: true,
      },
      source: "deploy-seed",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
      { merge: true },
    );

  await depositosByWaCol(params.tenantId)
    .doc(params.waId)
    .set(
      {
        depositoId: SEED_TEST_DEPOSITO_DOC_ID,
        waId: params.waId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return true;
}

async function ensureSeedDeposito(): Promise<void> {
  const tenantId = await resolveTenantId();
  const cnpj = normalizeWhatsAppId(SEED_TEST_DEPOSITO_CNPJ);
  const waId = normalizeBrazilWaId(SEED_TEST_DEPOSITO_PHONE_RAW);
  const bairroNorm = normalizeBairro(SEED_BAIRRO);

  if (!waId) {
    logger.error("SEED_TEST_DEPOSITO_INVALID_WA", { raw: SEED_TEST_DEPOSITO_PHONE_RAW });
    return;
  }

  await ensureTenantDoc(tenantId);

  const createdDeposito = await ensureTenantDeposito({
    tenantId,
    waId,
    cnpj,
    bairroNorm,
  });

  if (createdDeposito) {
    logger.info("SEED_TEST_DEPOSITO_CREATED", {
      tenantId,
      cnpj,
      waId,
      createdDeposito,
    });
  } else {
    logger.debug("SEED_TEST_DEPOSITO_ALREADY_EXISTS", {
      tenantId,
      cnpj,
      waId,
    });
  }
}

export const seedTestDeposito = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Sao_Paulo",
    region: DEFAULT_REGION,
  },
  seedTestDepositoHandler
);

export async function seedTestDepositoHandler() {
    if (!isFeatureEnabled("FEATURE_TEST_DEPOSITO_SEED_ENABLED", false)) {
      logger.warn("SEED_TEST_DEPOSITO_DISABLED");
      return;
    }
    await ensureSeedDeposito();
}
