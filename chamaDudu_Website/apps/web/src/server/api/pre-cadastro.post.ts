import { randomBytes } from 'crypto'
import { z } from 'zod'
import { hashToken } from '../utils/auth'
import { readJson, writeJsonAtomic } from '../utils/storage'
import type { Deposit, Lead } from '#shared/types'
import { normalizeBrazilWhatsApp, parseSupportedDdds, resolveRegionStatus } from '~/lib/phone/brWhatsApp'

const schema = z.object({
  nomeDeposito: z.string().trim().min(2).max(120),
  responsavel: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(8).max(20),
  bairro: z.string().trim().min(2).max(120),
  cidade: z.string().trim().min(2).max(120).optional(),
  cnpj: z.preprocess(
    (input) => {
      const value = String(input ?? '').trim()
      return value.length ? value : undefined
    },
    z.string().max(20, 'CNPJ muito longo.').optional()
  )
})

function sanitizeErrorMessage(input: unknown): string {
  const raw = String(input ?? '').trim()
  if (!raw) return 'Falha ao enviar pre-cadastro.'
  return raw.slice(0, 180)
}

/**
 * Mirror local — mantido como fallback para dev e rastreabilidade.
 * A fonte da verdade para autenticacao agora e o Firestore (via backend).
 */
async function writeLocalMirror(params: {
  payload: z.infer<typeof schema>
  tokenHash: string
  depositToken: string
  backendId: string
}): Promise<void> {
  const nowIso = new Date().toISOString()
  const leads = await readJson<Lead[]>('leads.json', [])
  const deposits = await readJson<Deposit[]>('deposits.json', [])

  const leadId = `lead_${Date.now()}_${randomBytes(2).toString('hex')}`

  const lead: Lead = {
    id: leadId,
    nome: params.payload.nomeDeposito,
    whatsapp: params.payload.whatsapp,
    bairro: params.payload.bairro,
    createdAt: nowIso,
    depositTokenHash: params.tokenHash
  }

  const deposito: Deposit = {
    id: params.backendId,
    nome: params.payload.nomeDeposito,
    whatsapp: params.payload.whatsapp,
    bairro: params.payload.bairro,
    status: 'closed',
    createdAt: nowIso,
    tokenHash: params.tokenHash
  }

  leads.unshift(lead)
  deposits.unshift(deposito)

  await writeJsonAtomic('leads.json', leads)
  await writeJsonAtomic('deposits.json', deposits)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dados invalidos',
      data: { message: parsed.error.issues[0]?.message ?? 'Campos obrigatorios ausentes.' }
    })
  }

  const config = useRuntimeConfig(event)
  const tenantId = String(config.public.defaultTenantId ?? '').trim()
  if (!tenantId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Configuracao ausente',
      data: { message: 'NUXT_PUBLIC_DEFAULT_TENANT_ID nao configurado.' }
    })
  }

  const apiBaseUrl = String(config.public.apiBaseUrl ?? '').trim().replace(/\/$/, '')
  if (!apiBaseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Configuracao ausente',
      data: { message: 'NUXT_PUBLIC_API_BASE_URL nao configurado.' }
    })
  }

  const sanitizedPayload = {
    ...parsed.data,
    whatsapp: parsed.data.whatsapp.replace(/[^\d]/g, '')
  }
  const supportedDdds = parseSupportedDdds(String(config.public.supportedDdds ?? '81'))
  const phone = normalizeBrazilWhatsApp(sanitizedPayload.whatsapp)
  if (!phone.valid || !phone.ddd) {
    throw createError({
      statusCode: 400,
      statusMessage: 'WhatsApp invalido',
      data: {
        message: 'Informe um WhatsApp valido com DDD.'
      }
    })
  }
  const regionStatus = resolveRegionStatus(phone.ddd, supportedDdds)
  if (regionStatus === 'unsupported') {
    return {
      ok: false,
      regionStatus: 'unsupported',
      message:
        'Ainda nao estamos disponiveis na sua regiao. No momento, o Chama o Dudu atende apenas alguns DDDs selecionados. Voce pode deixar seu interesse e a gente te avisa quando abrir na sua area.'
    }
  }

  // Gera o token ANTES do POST para que o backend possa persistir o hash no Firestore.
  const depositToken = randomBytes(4).toString('hex')
  const tokenHash = config.depositTokenSalt
    ? hashToken(depositToken, config.depositTokenSalt)
    : null

  let backendId = ''
  try {
    const result = await $fetch<{ id: string }>(
      `${apiBaseUrl}/api/pre-cadastro-deposito?tenantId=${encodeURIComponent(tenantId)}`,
      {
        method: 'POST',
        headers: {
          'x-admin-key': config.adminApiKey || ''
        },
        body: {
          ...sanitizedPayload,
          nome: sanitizedPayload.nomeDeposito, // Mapeia para o campo esperado pelo backend
          whatsappE164: sanitizedPayload.whatsapp,
          isPreCadastro: true,
          ...(tokenHash ? { tokenHash } : {})
        },
        timeout: 12000,
        retry: 1
      }
    )
    backendId = String(result.id)
  } catch (error) {
    const err = error as { data?: { reason?: string; message?: string }; statusCode?: number; statusMessage?: string }
    throw createError({
      statusCode: err.statusCode ?? 502,
      statusMessage: err.statusMessage ?? 'Falha na integracao com backend',
      data: {
        message: sanitizeErrorMessage(err.data?.message ?? err.data?.reason ?? err.statusMessage)
      }
    })
  }

  // Mirror local apenas como cache/auditoria secundaria.
  // O login ja usa o Firestore como fonte da verdade via validate-token.
  if (tokenHash && config.depositTokenSalt) {
    await writeLocalMirror({
      payload: sanitizedPayload,
      tokenHash,
      depositToken,
      backendId
    }).catch(() => {
      // Nao bloqueia o fluxo se o mirror local falhar.
    })
  }

  return {
    ok: true,
    id: backendId,
    regionStatus: 'supported',
    depositoId: backendId,
    depositToken: tokenHash ? depositToken : null
  }
})
