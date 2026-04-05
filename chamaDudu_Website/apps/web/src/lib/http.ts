import { apiFetch } from '~/lib/api/client'

type PreCadastroPayload = {
  nomeDeposito: string
  responsavel: string
  whatsapp: string
  bairro: string
  cidade: string
  cnpj?: string
  entregaPropria: boolean
  isPreCadastro: boolean
}

export type PrintQueueOrder = {
  id: string
  tenantId: string
  depositoId: string
  sequence: number
  status: 'queued' | 'printed'
  source: 'whatsapp_mock'
  customerName: string
  customerWhatsapp: string
  address: string
  bairro: string
  items: Array<{ nome: string; qtd: number; preco: number }>
  total: number
  createdAtIso: string
  printedAtIso?: string | null
}

export type PreCadastroResponse = {
  id?: string
  ok?: boolean
  regionStatus?: 'supported' | 'unsupported'
  message?: string
}

export function resolveApiBaseUrl(override?: string): string {
  const explicitOverride = String(override ?? '').trim()
  if (explicitOverride) return explicitOverride.replace(/\/$/, '')
  const config = useRuntimeConfig()
  const explicit = String(config.public.apiBaseUrl ?? '').trim()
  if (explicit) return explicit.replace(/\/$/, '')
  if (import.meta.dev) {
    return 'http://127.0.0.1:5001/your-project-id/southamerica-east1/dudu_opsAppV1'
  }
  return 'https://southamerica-east1-your-project-id.cloudfunctions.net/dudu_opsAppV1'
}

export async function postPreCadastroDeposito(payload: PreCadastroPayload): Promise<PreCadastroResponse> {
  return await apiFetch<PreCadastroResponse>('/api/pre-cadastro-deposito', {
      method: 'POST',
      body: payload,
      timeoutMs: 12000,
      retry: 1
    })
}

export async function checkApiHealth(): Promise<{ ok: boolean; timestamp: string }> {
  return await apiFetch<{ ok: boolean; timestamp: string }>(`${resolveApiBaseUrl()}/api/health`, {
    timeoutMs: 8000,
    retry: 0
  })
}

export async function seedPrintQueue(params: {
  tenantId: string
  depositoId: string
  quantity?: number
  apiBaseUrl?: string
}): Promise<{ ok: boolean; createdCount: number; firstOrderId: string | null }> {
  return await apiFetch(`${resolveApiBaseUrl(params.apiBaseUrl)}/api/print-queue/mock-seed`, {
    method: 'POST',
    body: params,
    timeoutMs: 10000,
    retry: 0
  })
}

export async function fetchNextPrintOrder(params: {
  tenantId: string
  depositoId: string
  apiBaseUrl?: string
}): Promise<{ ok: boolean; order: PrintQueueOrder }> {
  const query = new URLSearchParams({
    tenantId: params.tenantId,
    depositoId: params.depositoId
  }).toString()
  return await apiFetch(`${resolveApiBaseUrl(params.apiBaseUrl)}/api/print-queue/next?${query}`, {
    timeoutMs: 10000,
    retry: 0
  })
}

export async function markPrintOrderPrinted(params: {
  tenantId: string
  depositoId: string
  orderId: string
  apiBaseUrl?: string
}): Promise<{ ok: boolean; printedOrderId: string; createdOrderId: string | null; nextOrder: PrintQueueOrder }> {
  return await apiFetch(`${resolveApiBaseUrl(params.apiBaseUrl)}/api/print-queue/printed`, {
    method: 'POST',
    body: params,
    timeoutMs: 10000,
    retry: 0
  })
}
