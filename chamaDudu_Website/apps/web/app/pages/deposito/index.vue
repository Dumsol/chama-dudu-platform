<script setup lang="ts">
import type { Deposit, Order } from '#shared/types'

definePageMeta({
  middleware: 'auth-deposito'
})

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

const { data: meData, refresh: refreshMe } = await useFetch<Deposit>('/api/deposito/me')
const { data: ordersData, refresh: refreshOrders } = await useFetch<Order[]>('/api/deposito/orders')

const statusLoading = ref(false)
const me = computed(() => meData.value)
const orders = computed(() => ordersData.value || [])

const toggleStatus = async () => {
  if (!me.value) return
  statusLoading.value = true
  const nextStatus = me.value.status === 'open' ? 'closed' : 'open'
  await $fetch('/api/deposito/status', {
    method: 'POST',
    body: { status: nextStatus }
  })
  await Promise.all([refreshMe(), refreshOrders()])
  statusLoading.value = false
}

const logout = async () => {
  await $fetch('/api/deposito/logout', { method: 'POST' })
  await navigateTo('/deposito/login')
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
  <div class="min-h-screen bg-neutral-100">
    <div class="dudu-container py-10">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-extrabold text-neutral-900">Painel do depósito</h1>
          <p class="text-sm text-neutral-600">{{ me?.nome }} - {{ me?.bairro }}</p>
        </div>
        <button
          class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700"
          @click="logout"
        >
          Sair
        </button>
      </div>

      <div class="mt-6 grid gap-4 md:grid-cols-[1fr_2fr]">
        <div class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
          <p class="text-xs font-semibold text-neutral-500">Status atual</p>
          <p class="mt-2 text-2xl font-extrabold text-neutral-900">
            {{ me?.status === 'open' ? 'Aberto' : 'Fechado' }}
          </p>
          <button
            class="mt-4 w-full rounded-full bg-dudu-green px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(47,179,74,0.35)] disabled:opacity-60"
            :disabled="statusLoading"
            @click="toggleStatus"
          >
            {{ statusLoading ? 'Atualizando...' : 'Alternar status' }}
          </button>
          <p class="mt-3 text-xs text-neutral-500">
            Comandos equivalentes no WhatsApp: abrir, fechar, status.
          </p>
        </div>
        <div class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
          <h2 class="text-lg font-extrabold text-neutral-900">Pedidos</h2>
          <div class="mt-4 space-y-3">
            <div
              v-for="order in orders"
              :key="order.id"
              class="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-sm text-neutral-700"
            >
              <div class="flex items-center justify-between">
                <p class="font-semibold text-neutral-900">Pedido {{ order.id }}</p>
                <NuxtLink :to="`/imprimir/${order.id}`" class="text-xs font-semibold text-dudu-green">
                  Imprimir
                </NuxtLink>
              </div>
              <p>{{ order.bairro }} - R$ {{ formatMoney(order.total) }}</p>
            </div>
            <p v-if="orders.length === 0" class="text-sm text-neutral-500">
              Nenhum pedido por aqui ainda.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
