import * as crypto from "crypto";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "../../infra/config/firebase";
import { painelConfigSecret, readAdminApiKey } from "../../infra/config/secrets";
import { depositosCol, depositosByWaCol, usersCol, messagesCol } from "../../infra/firestore/duduPaths";

const DEFAULT_TENANT_ID =
  process.env.SINGLE_TENANT_CNPJ ?? process.env.SINGLE_TENANT_KEY ?? "";
const ALLOW_SINGLE_TENANT_FALLBACK =
  Boolean(process.env.FUNCTIONS_EMULATOR) || Boolean(process.env.FIREBASE_EMULATOR_HUB);

function resolveTenantFromRequest(req: any, body: DepositoRegisterBody): string | null {
  const fromQuery = String(req.query?.tenantId ?? req.query?.tenantCnpj ?? "").trim();
  const fromHeader = String(req.header("x-tenant-id") ?? req.header("x-tenant-cnpj") ?? "").trim();
  const fromBody = String(body?.tenantId ?? body?.tenantCnpj ?? "").trim();
  const resolved = fromQuery || fromHeader || fromBody;
  if (resolved) return resolved;
  if (ALLOW_SINGLE_TENANT_FALLBACK && DEFAULT_TENANT_ID) return DEFAULT_TENANT_ID;
  return null;
}

type HorarioInput = {
  dow: number;
  abre?: string | null;
  fecha?: string | null;
  fechado?: boolean | null;
};

type EnderecoInput = {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
};

type DepositoRegisterBody = {
  tenantId?: string | null;
  tenantCnpj?: string | null;
  nome?: string | null;
  responsavel?: string | null;
  cnpj?: string | null;
  whatsapp?: string | null; // Suporte para o campo enviado pelo site
  whatsappE164?: string | null;
  endereco?: EnderecoInput | null;
  bairro?: string | null; // Suporte para o campo no topo do body (site)
  cidade?: string | null; // Suporte para o campo no topo do body (site)
  horarios?: HorarioInput[] | null;
  ativo?: boolean | null;
  taxaClienteCentavos?: number | null;
  deliveryDisponivel?: boolean | null;
  retiradaDisponivel?: boolean | null;
  timezone?: string | null;
  isPreCadastro?: boolean | null;
  entregaPropria?: boolean | null; // Sim=true, Não=false
};

function jsonError(res: any, status: number, error: string, details?: any): void {
  res.status(status).json({ ok: false, error, ...(details ? { details } : {}) });
}

export function normalizeDigits(input: string | null | undefined): string {
  return String(input ?? "").replace(/\D/g, "");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const aHash = crypto.createHash("sha256").update(a, "utf8").digest();
  const bHash = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

export function isValidCnpjDigits(cnpjDigits: string): boolean {
  if (!/^\d{14}$/.test(cnpjDigits)) return false;
  if (/^(\d)\1{13}$/.test(cnpjDigits)) return false;

  const calcDigit = (base: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
      sum += Number(base[i]) * weights[i];
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calcDigit(cnpjDigits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcDigit(cnpjDigits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cnpjDigits[12]) && d2 === Number(cnpjDigits[13]);
}

/**
 * Valida CPF (11 dígitos).
 */
export function isValidCpfDigits(cpfDigits: string): boolean {
  if (!/^\d{11}$/.test(cpfDigits)) return false;
  if (/^(\d)\1{10}$/.test(cpfDigits)) return false;

  const calcDigit = (base: string, length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(base[i]) * (length + 1 - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calcDigit(cpfDigits, 9);
  const d2 = calcDigit(cpfDigits, 10);
  return d1 === Number(cpfDigits[9]) && d2 === Number(cpfDigits[10]);
}

/**
 * Verifica se o nome completo tem pelo menos 2 palavras com 2+ chars cada.
 */
export function isNomeCompleto(nome: string): boolean {
  const words = nome.trim().split(/\s+/).filter((w) => w.length >= 2);
  return words.length >= 2;
}

/**
 * Decide se o pre-cadastro deve ser auto-aprovado.
 * Critérios: nome completo válido + documento válido (CNPJ ou CPF) + WhatsApp válido.
 */
export function shouldAutoApprove(params: {
  responsavel: string;
  cnpjOrCpfDigits: string;
  waDigits: string;
}): { approved: boolean; reason: string } {
  if (!isNomeCompleto(params.responsavel)) {
    return { approved: false, reason: "nome_incompleto" };
  }
  const digits = params.cnpjOrCpfDigits;
  if (digits.length === 14) {
    if (!isValidCnpjDigits(digits)) {
      return { approved: false, reason: "cnpj_invalido" };
    }
  } else if (digits.length === 11) {
    if (!isValidCpfDigits(digits)) {
      return { approved: false, reason: "cpf_invalido" };
    }
  } else {
    return { approved: false, reason: "documento_ausente_ou_invalido" };
  }
  if (params.waDigits.length < 10 || params.waDigits.length > 13) {
    return { approved: false, reason: "whatsapp_invalido" };
  }
  return { approved: true, reason: "auto_approved" };
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateHorarios(horarios: HorarioInput[]): string[] {
  const errors: string[] = [];
  horarios.forEach((h, idx) => {
    if (!Number.isInteger(h.dow) || h.dow < 0 || h.dow > 6) {
      errors.push(`horarios[${idx}].dow invalido`);
      return;
    }

    const fechado = Boolean(h.fechado);
    const abre = h.abre ?? null;
    const fecha = h.fecha ?? null;

    if (fechado) {
      if (abre || fecha) {
        errors.push(`horarios[${idx}] fechado=true nao pode ter abre/fecha`);
      }
      return;
    }

    if (!abre || !fecha) {
      errors.push(`horarios[${idx}] exige abre/fecha`);
      return;
    }

    if (!isValidTime(abre) || !isValidTime(fecha)) {
      errors.push(`horarios[${idx}] abre/fecha formato HH:mm`);
    }
  });

  return errors;
}

export const depositoRegister = onRequest(
  {
    region: "southamerica-east1",
    secrets: [painelConfigSecret],
  },
  depositoRegisterHandler
);

export async function depositoRegisterHandler(req: any, res: any) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "no-store");

    const method = String(req.method ?? "").toUpperCase();
    if (method !== "POST") {
      logger.warn(`depositoRegister: method not allowed: ${method} on path ${req.path}`);
      return jsonError(res, 405, "method_not_allowed", { receivedMethod: method });
    }

    const body = (req.body ?? {}) as DepositoRegisterBody;
    const isPreCadastro = Boolean(body.isPreCadastro);

    const expectedKey = readAdminApiKey().trim();
    if (!expectedKey) {
      logger.error("depositoRegister: ADMIN_API_KEY ausente (misconfig)");
      return jsonError(res, 500, "server_misconfigured");
    }

    const providedKey = String(req.header("x-admin-key") ?? "").trim();
    const isAuthorized = providedKey && timingSafeEqualStr(providedKey, expectedKey);

    // Permitimos publicamente apenas se for PRE-CADASTRO do site.
    // Registros completos (admin) ou alterações exigem chave.
    if (!isAuthorized && !isPreCadastro) {
      return jsonError(res, 401, "unauthorized");
    }


    const tenantCnpj = resolveTenantFromRequest(req, body);
    if (!tenantCnpj) {
      return jsonError(res, 400, "tenant_required");
    }
    const nome = String(body.nome ?? "").trim();
    if (!nome) return jsonError(res, 400, "invalid_nome");

    const cnpjDigits = normalizeDigits(body.cnpj);
    const hasValidCnpj = cnpjDigits.length === 14 && isValidCnpjDigits(cnpjDigits);

    // Se vier do site, o CNPJ pode ser inválido/parcial. Bloqueamos apenas se for um registro oficial que falta CNPJ.
    if (cnpjDigits && !hasValidCnpj && !body.isPreCadastro) {
      return jsonError(res, 400, "invalid_cnpj");
    }

    const waDigits = normalizeDigits(body.whatsappE164 || body.whatsapp);
    if (waDigits.length < 10 || waDigits.length > 13) {
      return jsonError(res, 400, "invalid_whatsapp");
    }

    const endereco = (body.endereco ?? {}) as EnderecoInput;
    const bairro = String(body.bairro ?? endereco.bairro ?? "").trim();
    const cidade = String(body.cidade ?? endereco.cidade ?? "").trim();
    // Em pre-cadastro do site, UF pode ser omitida (assume-se PE por default se não informado)
    const ufRaw = String(endereco.uf ?? "PE").trim().toUpperCase();

    if (!bairro) {
      return jsonError(res, 400, "invalid_bairro");
    }

    // Cidade agora é obrigatória em todos os fluxos
    if (!cidade) {
      return jsonError(res, 400, "invalid_cidade");
    }
    
    // UF deve ter 2 caracteres
    if (!/^[A-Z]{2}$/.test(ufRaw)) {
      return jsonError(res, 400, "invalid_uf");
    }

    const horarios = Array.isArray(body.horarios) ? body.horarios : [];
    if (horarios.length) {
      const errors = validateHorarios(horarios);
      if (errors.length) {
        return jsonError(res, 400, "invalid_horarios", errors);
      }
    }

    const taxaClienteCentavosRaw =
      body.taxaClienteCentavos == null ? 99 : Number(body.taxaClienteCentavos);
    if (
      !Number.isFinite(taxaClienteCentavosRaw) ||
      taxaClienteCentavosRaw < 0 ||
      taxaClienteCentavosRaw > 9999
    ) {
      return jsonError(res, 400, "invalid_taxa_cliente");
    }

    // Auto-aprovação para pre-cadastros com documentos e dados válidos
    const responsavel = String(body.responsavel ?? "").trim();
    const cnpjOrCpfDigits = cnpjDigits; // 14=CNPJ, 11=CPF
    const autoApprovalResult = isPreCadastro
      ? shouldAutoApprove({ responsavel, cnpjOrCpfDigits, waDigits })
      : { approved: true, reason: "admin_register" };

    // Pre-cadastros aprovados ficam ativos; reprovados ficam pendentes para revisão admin
    const ativoFinal = isPreCadastro
      ? (body.ativo == null ? autoApprovalResult.approved : Boolean(body.ativo))
      : (body.ativo == null ? true : Boolean(body.ativo));

    const ativo = ativoFinal;
    const deliveryDisponivel =
      body.deliveryDisponivel == null ? true : Boolean(body.deliveryDisponivel);
    const retiradaDisponivel =
      body.retiradaDisponivel == null ? true : Boolean(body.retiradaDisponivel);

    // ID baseado no CNPJ se válido, senão no WhatsApp (para pre-cadastros sem CNPJ)
    const depositoId = hasValidCnpj ? `dep_cnpj_${cnpjDigits}` : `pre_wa_${waDigits}`;
    const depositoRef = depositosCol(tenantCnpj).doc(depositoId);
    const ptrRef = depositosByWaCol(tenantCnpj).doc(waDigits);
    const userRef = usersCol(tenantCnpj).doc(waDigits);

    try {
      const result = await depositoRef.firestore.runTransaction(async (tx) => {
        const [depositoSnap, ptrSnap, userSnap] = await Promise.all([
          tx.get(depositoRef),
          tx.get(ptrRef),
          tx.get(userRef),
        ]);
        const exists = depositoSnap.exists;
        const existingData = exists ? (depositoSnap.data() as any) : null;

        const now = FieldValue.serverTimestamp();

        const depositData: Record<string, any> = {
          id: depositoId,
          tenantCnpj,
          nome,
          bairro,
          waId: waDigits,
          cnpjDigits,
          whatsappE164: waDigits,
          endereco: {
            logradouro: String(endereco.logradouro ?? "").trim() || null,
            numero: String(endereco.numero ?? "").trim() || null,
            complemento: String(endereco.complemento ?? "").trim() || null,
            bairro,
            cidade,
            uf: ufRaw,
            cep: String(endereco.cep ?? "").trim() || null,
          },
          horarios: horarios.length ? horarios : null,
          ativo,
          taxaClienteCentavos: Math.trunc(taxaClienteCentavosRaw),
          deliveryDisponivel,
          retiradaDisponivel,
          entregaPropria: body.entregaPropria != null ? Boolean(body.entregaPropria) : null,
          timezone: String(body.timezone ?? "").trim() || null,
          status: existingData?.status ?? (ativo ? "ABERTO" : "FECHADO"),
          // Pre-cadastro status: "approved" (auto), "pending" (aguarda admin), "rejected"
          preCadastroStatus: isPreCadastro
            ? (autoApprovalResult.approved ? "approved" : "pending")
            : (existingData?.preCadastroStatus ?? "approved"),
          preCadastroApprovalReason: autoApprovalResult.reason,
          updatedAt: now,
        };

        if (!exists) {
          depositData.createdAt = now;
        }

        tx.set(depositoRef, depositData, { merge: true });

        tx.set(
          ptrRef,
          {
            depositoId,
            cnpjDigits,
            updatedAt: now,
            ...(ptrSnap.exists ? {} : { createdAt: now }),
          },
          { merge: true },
        );

        tx.set(
          userRef,
          {
            waId: waDigits,
            type: "deposito",
            depositoId,
            updatedAt: now,
            ...(userSnap.exists ? {} : { createdAt: now }),
          },
          { merge: true },
        );

        return { created: !exists };
      });

      const status = result.created ? 201 : 200;

      // Dispara template de confirmacao se for novo cadastro
      if (result.created) {
        try {
          const responsavel = String(body.responsavel ?? "Parceiro").trim();
          await messagesCol(tenantCnpj).add({
            to: waDigits,
            type: "template",
            template: {
              name: "deposito_pre_cadastro_confirmacao_v1",
              language: { code: "pt_BR" },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: responsavel },
                    { type: "text", text: nome },
                  ],
                },
              ],
            },
            createdAt: FieldValue.serverTimestamp(),
            status: "pending",
          });
        } catch (msgErr) {
          logger.error("Failed to queue welcome message", { waDigits, error: msgErr });
        }
      }

      res.status(status).json({
        ok: true,
        depositoId,
        id: depositoId,
        created: result.created,
        updated: !result.created,
        preCadastroStatus: isPreCadastro
          ? (autoApprovalResult.approved ? "approved" : "pending")
          : "approved",
      });
      return;
    } catch (err: any) {
      logger.error("depositoRegister failed", {
        depositoId,
        errorMessage: err?.message ?? String(err),
      });
      return jsonError(res, 500, "internal_error");
    }
}
