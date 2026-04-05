<script setup lang="ts">
import type { Order } from '#shared/types'

definePageMeta({
  layout: 'print'
})

const route = useRoute()
const orderId = computed(() => route.params.orderId as string)
const paperWidth = computed(() => (route.query.w === '58' ? '58mm' : '80mm'))

useHead({
  style: [
    {
      children: `@page { size: ${paperWidth.value} auto; margin: 4mm; }`
    }
  ]
})

const { data, error } = await useFetch<Order>(`/api/orders/${orderId.value}`)

const order = computed(() => data.value)

const formattedDate = computed(() => {
  if (!order.value?.createdAt) return ''
  const date = new Date(order.value.createdAt)
  return date.toLocaleString('pt-BR')
})

const pedidoId = computed(() => {
  if (!order.value) return ''
  const digits = String(order.value.depositoWhatsapp || '').replace(/\D/g, '')
  const last4 = digits.slice(-4) || '0000'
  const orderSuffix = String(order.value.id).slice(-4)
  return `Pedido Dudu ${last4}_#${orderSuffix}`
})

const onPrint = () => {
  if (import.meta.client) {
    window.print()
  }
}

const formatMoney = (value: number | string) => {
  const amount = typeof value === 'string' ? Number(value) : value
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}
</script>

<template>
  <div class="flex min-h-screen items-start justify-center bg-neutral-100 py-8 print:bg-white">
    <div
      class="print-sheet rounded-lg border border-neutral-200 bg-white p-4 text-[12px] text-black shadow-soft print:shadow-none"
      :style="{ width: paperWidth }"
    >
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-base font-bold">Chama Dudu</h1>
          <p class="text-[11px]">Chama Dudu salva na madrugada.</p>
        </div>
        <button
          class="print-hidden rounded-full border border-neutral-300 px-3 py-1 text-[11px] font-semibold"
          @click="onPrint"
        >
          Imprimir
        </button>
      </div>

      <div class="mt-3 border-t border-dashed border-neutral-300 pt-3">
        <p class="text-[11px] font-semibold">{{ pedidoId }}</p>
        <p class="text-[11px]">Data: {{ formattedDate }}</p>
      </div>

      <div v-if="error" class="mt-4 text-[11px] text-red-600">
        Pedido não encontrado.
      </div>

      <div v-else-if="order" class="mt-4 space-y-3">
        <div>
          <p class="text-[11px] font-semibold">Depósito</p>
          <p>{{ order.depositoNome }}</p>
          <p class="text-[11px] text-neutral-600">{{ order.depositoWhatsapp }}</p>
        </div>
        <div>
          <p class="text-[11px] font-semibold">Cliente</p>
          <p>{{ order.clienteNome }}</p>
          <p class="text-[11px] text-neutral-600">{{ order.clienteWhatsapp }}</p>
        </div>
        <div>
          <p class="text-[11px] font-semibold">Endereço</p>
          <p>{{ order.endereco }}</p>
          <p class="text-[11px] text-neutral-600">{{ order.bairro }}</p>
        </div>

        <div class="border-t border-dashed border-neutral-300 pt-3">
          <p class="text-[11px] font-semibold">Itens</p>
          <div class="mt-2 space-y-1">
            <div
              v-for="item in order.itens"
              :key="item.nome"
              class="flex items-center justify-between"
            >
              <span>{{ item.qtd }}x {{ item.nome }}</span>
              <span>R$ {{ formatMoney(item.preco) }}</span>
            </div>
          </div>
        </div>

        <div class="border-t border-dashed border-neutral-300 pt-3">
          <div class="flex items-center justify-between">
            <span>Taxa de serviço</span>
            <span>R$ 0,99</span>
          </div>
          <p class="text-[11px] text-neutral-600">Cobrar na entrega.</p>
          <div class="mt-2 flex items-center justify-between text-sm font-semibold">
            <span>Total</span>
            <span>R$ {{ formatMoney(order.total) }}</span>
          </div>
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

  .print-sheet {
    border: none;
    border-radius: 0;
    padding: 0;
    box-shadow: none;
  }

  body {
    background: white;
  }
}
</style>
