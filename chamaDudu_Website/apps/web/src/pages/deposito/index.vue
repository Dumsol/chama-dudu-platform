<script setup lang="ts">
import type { Deposit, DepositoMiniDashboard, Order } from '#shared/types'
import { logoutDeposito, updateDepositoStatus } from '~/lib/api/backoffice'

definePageMeta({
  middleware: 'auth-deposito'
})

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

const { data: meData, refresh: refreshMe } = await useFetch<Deposit>('/api/deposito/me')
const { data: ordersData, refresh: refreshOrders } = await useFetch<Order[]>('/api/deposito/orders')
const { data: dashboardData, error: dashboardError, refresh: refreshDashboard } = await useFetch<{
  ok: boolean
  dashboard: DepositoMiniDashboard
}>('/api/deposito/dashboard')

const statusLoading = ref(false)
const me = computed(() => meData.value)
const orders = computed(() => ordersData.value || [])
const dashboard = computed<DepositoMiniDashboard | null>(() => dashboardData.value?.dashboard ?? null)

const toggleStatus = async () => {
  if (!me.value) return
  statusLoading.value = true
  const nextStatus = me.value.status === 'open' ? 'closed' : 'open'
  try {
    await updateDepositoStatus(nextStatus)
    await Promise.all([refreshMe(), refreshOrders(), refreshDashboard()])
  } finally {
    statusLoading.value = false
  }
}

const logout = async () => {
  await logoutDeposito()
  await navigateTo('/_ops/deposito-login')
}

const formatMoney = (value: number | string) => {
  const amount = typeof value === 'string' ? Number(value) : value
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}

const formatCentavos = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format((value || 0) / 100)
</script>

<template>
  <div class="min-h-screen bg-neutral-100">
    <div class="dudu-container py-10">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-extrabold text-neutral-900">Painel do deposito</h1>
          <p class="text-sm text-neutral-600">{{ me?.nome }} - {{ me?.bairro }}</p>
        </div>
        <button
          class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700"
          @click="logout"
        >
          Sair
        </button>
      </div>

      <div class="mt-6 grid gap-4 md:grid-cols-4">
        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
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
        </div>

        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
          <p class="text-xs font-semibold text-neutral-500">Pedidos ativos</p>
          <p class="mt-2 text-2xl font-extrabold text-neutral-900">{{ dashboard?.activeOrders ?? 0 }}</p>
        </div>

        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
          <p class="text-xs font-semibold text-neutral-500">Fila curta</p>
          <p class="mt-2 text-2xl font-extrabold text-neutral-900">{{ dashboard?.queueOrders ?? 0 }}</p>
        </div>

        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
          <p class="text-xs font-semibold text-neutral-500">Receita do dia</p>
          <p class="mt-2 text-2xl font-extrabold text-neutral-900">{{ formatCentavos(dashboard?.todayGmvCentavos ?? 0) }}</p>
        </div>
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
          <h2 class="text-lg font-extrabold text-neutral-900">Indicadores do deposito</h2>
          <div class="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
            <div class="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
              <p class="text-neutral-500">Entregues hoje</p>
              <p class="text-lg font-bold text-neutral-900">{{ dashboard?.deliveredToday ?? 0 }}</p>
            </div>
            <div class="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
              <p class="text-neutral-500">Taxa de aceitacao</p>
              <p class="text-lg font-bold text-neutral-900">{{ Number(dashboard?.acceptanceRatePct ?? 0).toFixed(2) }}%</p>
            </div>
            <div class="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
              <p class="text-neutral-500">Tempo medio preparo</p>
              <p class="text-lg font-bold text-neutral-900">{{ dashboard?.avgPrepMinutes ?? 0 }} min</p>
            </div>
            <div class="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
              <p class="text-neutral-500">Tempo medio entrega</p>
              <p class="text-lg font-bold text-neutral-900">{{ dashboard?.avgDeliveryMinutes ?? 0 }} min</p>
            </div>
          </div>
          <p v-if="dashboardError" class="mt-3 text-xs font-semibold text-amber-700">
            Nao foi possivel carregar indicadores do backend agora. O painel local segue ativo.
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

      <div v-if="dashboard?.alerts?.length" class="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
        <h2 class="text-lg font-extrabold text-neutral-900">Alertas</h2>
        <ul class="mt-4 space-y-2 text-sm">
          <li
            v-for="alert in dashboard.alerts"
            :key="`${alert.code}-${alert.title}`"
            class="rounded-xl border px-4 py-2"
            :class="alert.severity === 'critical' ? 'border-red-200 bg-red-50 text-red-700' : alert.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-sky-200 bg-sky-50 text-sky-700'"
          >
            <strong>{{ alert.title }}</strong>: {{ alert.value }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
