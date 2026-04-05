<script setup lang="ts">
import {
  fetchNextPrintOrder,
  markPrintOrderPrinted,
  seedPrintQueue,
  type PrintQueueOrder
} from '~/lib/http'

useHead({
  title: 'Fila de Impressao - Chama Dudu',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

const config = useRuntimeConfig()
const tenantId = ref('tenant-smoke')
const depositoId = ref('dep-printer-1')
const seedAmount = ref(5)
const apiBaseUrl = ref(String(config.public.apiBaseUrl || ''))
const statusText = ref('Pronto para iniciar.')
const currentOrder = ref<PrintQueueOrder | null>(null)
const loading = ref(false)
const busy = ref(false)

const printerCheck = ref({
  canPrint: false,
  hasUsbApi: false,
  hasSerialApi: false,
  userAgent: ''
})

if (import.meta.client) {
  printerCheck.value = {
    canPrint: typeof window.print === 'function',
    hasUsbApi: 'usb' in navigator,
    hasSerialApi: 'serial' in navigator,
    userAgent: navigator.userAgent
  }
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

const formatDate = (iso: string) => {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('pt-BR')
}

type ApiError = {
  data?: {
    reason?: string
    message?: string
  }
  message?: string
}

const getErrorMessage = (error: unknown) => {
  const err = error as ApiError
  return err?.data?.reason || err?.data?.message || err?.message || 'erro desconhecido'
}

const loadNextOrder = async () => {
  busy.value = true
  statusText.value = 'Buscando proxima ordem da fila...'
  try {
    const data = await fetchNextPrintOrder({
      tenantId: tenantId.value.trim(),
      depositoId: depositoId.value.trim(),
      apiBaseUrl: apiBaseUrl.value.trim()
    })
    currentOrder.value = data.order
    statusText.value = `Ordem #${data.order.sequence} pronta para imprimir.`
  } catch (error: unknown) {
    statusText.value = `Falha ao buscar fila: ${getErrorMessage(error)}`
  } finally {
    busy.value = false
  }
}

const seedMockQueue = async () => {
  busy.value = true
  statusText.value = 'Gerando pedidos mock na fila...'
  try {
    const data = await seedPrintQueue({
      tenantId: tenantId.value.trim(),
      depositoId: depositoId.value.trim(),
      quantity: Number(seedAmount.value || 5),
      apiBaseUrl: apiBaseUrl.value.trim()
    })
    statusText.value = `Fila criada com ${data.createdCount} pedidos.`
    await loadNextOrder()
  } catch (error: unknown) {
    statusText.value = `Falha ao semear fila: ${getErrorMessage(error)}`
  } finally {
    busy.value = false
  }
}

const printCurrent = () => {
  if (!import.meta.client) return
  window.print()
}

const markPrintedAndNext = async () => {
  if (!currentOrder.value) return
  loading.value = true
  statusText.value = 'Confirmando impressao e puxando proxima ordem...'
  try {
    const data = await markPrintOrderPrinted({
      tenantId: tenantId.value.trim(),
      depositoId: depositoId.value.trim(),
      orderId: currentOrder.value.id,
      apiBaseUrl: apiBaseUrl.value.trim()
    })
    currentOrder.value = data.nextOrder
    statusText.value = `Impressa ${data.printedOrderId}. Nova ordem: #${data.nextOrder.sequence}.`
  } catch (error: unknown) {
    statusText.value = `Falha ao confirmar impressao: ${getErrorMessage(error)}`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-neutral-100 py-8">
    <div class="dudu-container">
      <div class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
        <h1 class="text-2xl font-extrabold text-neutral-900">Fila de impressao (mock WhatsApp)</h1>
        <p class="mt-2 text-sm text-neutral-600">
          Fluxo: gera pedidos mock, imprime, confirma impressao e ja recebe a proxima ordem.
        </p>

        <div class="mt-6 grid gap-3 md:grid-cols-5">
          <input v-model="apiBaseUrl" class="rounded-lg border border-neutral-300 px-3 py-2 text-sm md:col-span-2" placeholder="API base URL">
          <input v-model="tenantId" class="rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="tenantId">
          <input v-model="depositoId" class="rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="depositoId">
          <input
            v-model.number="seedAmount"
            type="number"
            min="1"
            max="50"
            class="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            placeholder="qtd inicial"
          >
          <div class="flex gap-2">
            <button class="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white" :disabled="busy" @click="seedMockQueue">
              Gerar fila
            </button>
            <button class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold" :disabled="busy" @click="loadNextOrder">
              Atualizar
            </button>
          </div>
        </div>

        <div class="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          {{ statusText }}
        </div>

        <div class="mt-6 rounded-2xl border border-neutral-200 p-4">
          <h2 class="text-lg font-bold text-neutral-900">Check da impressora</h2>
          <div class="mt-3 grid gap-2 text-sm text-neutral-700 md:grid-cols-2">
            <p>Janela de impressao disponivel: <strong>{{ printerCheck.canPrint ? 'SIM' : 'NAO' }}</strong></p>
            <p>WebUSB disponivel: <strong>{{ printerCheck.hasUsbApi ? 'SIM' : 'NAO' }}</strong></p>
            <p>WebSerial disponivel: <strong>{{ printerCheck.hasSerialApi ? 'SIM' : 'NAO' }}</strong></p>
            <p class="truncate">Navegador: <strong>{{ printerCheck.userAgent || '-' }}</strong></p>
          </div>
          <p class="mt-2 text-xs text-neutral-500">
            Observacao: navegador nao consegue listar impressoras instaladas por seguranca.
            O check real e clicar em "Imprimir ordem atual" e validar se a termica aparece na caixa de impressao.
          </p>
        </div>

        <div v-if="currentOrder" class="mt-6 rounded-2xl border border-neutral-900 bg-white p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-semibold text-neutral-500">Ordem da fila</p>
              <p class="text-2xl font-extrabold text-neutral-900">#{{ currentOrder.sequence }}</p>
            </div>
            <div class="flex gap-2 print-hidden">
              <button class="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold" @click="printCurrent">
                Imprimir ordem atual
              </button>
              <button
                class="rounded-lg bg-dudu-green px-3 py-2 text-sm font-semibold text-white"
                :disabled="loading"
                @click="markPrintedAndNext"
              >
                {{ loading ? 'Processando...' : 'Marcar impressa e proxima' }}
              </button>
            </div>
          </div>

          <div class="mt-4 border-t border-dashed border-neutral-300 pt-3 text-sm">
            <p><strong>Pedido:</strong> {{ currentOrder.id }}</p>
            <p><strong>Cliente:</strong> {{ currentOrder.customerName }} ({{ currentOrder.customerWhatsapp }})</p>
            <p><strong>Endereco:</strong> {{ currentOrder.address }}</p>
            <p><strong>Bairro:</strong> {{ currentOrder.bairro }}</p>
            <p><strong>Recebido:</strong> {{ formatDate(currentOrder.createdAtIso) }}</p>
          </div>

          <div class="mt-4 border-t border-dashed border-neutral-300 pt-3">
            <p class="text-sm font-semibold">Itens</p>
            <div class="mt-2 space-y-1 text-sm">
              <div v-for="(item, idx) in currentOrder.items" :key="`${item.nome}-${idx}`" class="flex items-center justify-between">
                <span>{{ item.qtd }}x {{ item.nome }}</span>
                <span>R$ {{ formatMoney(item.preco * item.qtd) }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 border-t border-dashed border-neutral-300 pt-3 text-sm font-semibold">
            <div class="flex items-center justify-between">
              <span>Total</span>
              <span>R$ {{ formatMoney(currentOrder.total) }}</span>
            </div>
          </div>
        </div>

        <div v-else class="mt-6 rounded-xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-500">
          Nenhuma ordem carregada ainda. Clique em "Gerar fila" ou "Atualizar".
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media print {
  .print-hidden {
    display: none;
  }
}
</style>
