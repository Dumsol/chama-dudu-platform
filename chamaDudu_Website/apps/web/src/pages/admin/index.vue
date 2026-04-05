<script setup lang="ts">
import type { WarRoomOverview, WarRoomRange } from '#shared/types'
import { extractApiErrorMessage, apiFetch } from '~/lib/api/client'
import { logoutAdmin } from '~/lib/api/backoffice'

definePageMeta({
  middleware: 'auth-admin'
})

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

const config = useRuntimeConfig()
const tenantId = config.public.defaultTenantId || 'dudu'

const selectedRange = ref<WarRoomRange>('7d')
const selectedGroupBy = ref<'bairro' | 'cidade' | 'canal' | 'hour'>('bairro')
const forecastHorizon = ref(7)
const refreshing = ref(false)
const refreshError = ref('')

const query = computed(() => ({
  tenantId,
  range: selectedRange.value,
  groupBy: selectedGroupBy.value,
  horizon: forecastHorizon.value
}))

const { data, pending, error, refresh } = await useAsyncData<{ ok: boolean; overview: WarRoomOverview }>(
  'war-room-overview',
  () => apiFetch('/api/admin/war-room/overview', { query: query.value }),
  { 
    watch: [query],
    getCachedData: (key) => {
      const nuxtApp = useNuxtApp()
      const cached = nuxtApp.payload.data[key] || nuxtApp.static.data[key]
      if (!cached) return
      
      // Cache de 2 minutos para evitar leituras repetitivas no Firebase
      const timestamp = (cached as any)._fetchedAt || 0
      if (Date.now() - timestamp > 2 * 60 * 1000) return
      
      return cached
    },
    transform: (res) => {
      return {
        ...res,
        _fetchedAt: Date.now()
      }
    }
  }
)

const overview = computed<WarRoomOverview | null>(() => data.value?.overview ?? null)

type ConnectivityStatus = {
  ok: boolean
  apiBaseUrl: string
  tenantId: string
  checks: {
    health: { ok: boolean; latencyMs: number | null; message?: string }
    overview: { ok: boolean; latencyMs: number | null; message?: string }
  }
  timestamp: string
}

const {
  data: connectivityData,
  pending: connectivityPending,
  refresh: refreshConnectivity
} = await useAsyncData<ConnectivityStatus>(
  'admin-connectivity',
  () => apiFetch('/api/admin/connectivity')
)

const connectivity = computed<ConnectivityStatus | null>(() => connectivityData.value ?? null)

const refreshWarRoom = async () => {
  refreshError.value = ''
  refreshing.value = true
  try {
    await $fetch('/api/admin/war-room/refresh', {
      method: 'POST',
      body: {
        tenantId,
        range: selectedRange.value,
        groupBy: selectedGroupBy.value,
        horizon: forecastHorizon.value
      }
    })
    await refresh()
    await refreshConnectivity()
  } catch (err) {
    refreshError.value = extractApiErrorMessage(err, 'Falha ao atualizar os dados do War Room.')
  } finally {
    refreshing.value = false
  }
}

const logout = async () => {
  await logoutAdmin()
  await navigateTo('/_ops/admin-login')
}

const formatMoney = (centavos: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format((centavos || 0) / 100)

const formatPct = (value: number) => `${Number(value || 0).toFixed(2)}%`

const kpiCards = computed(() => {
  const kpi = overview.value?.kpis
  if (!kpi) return []
  return [
    { label: 'GMV', value: formatMoney(kpi.gmvCentavos) },
    { label: 'Custos conhecidos', value: formatMoney(kpi.knownCostsCentavos) },
    { label: 'Lucro operacional v1', value: formatMoney(kpi.profitCentavos) },
    { label: 'Margem', value: formatPct(kpi.marginPct) },
    { label: 'Pedidos', value: String(kpi.ordersTotal) },
    { label: 'Pedidos ativos', value: String(kpi.ordersActive) },
    { label: 'SLA medio (min)', value: String(kpi.slaAvgMinutes) },
    { label: 'Conversao pre-cadastro', value: formatPct(kpi.conversionRatePct) }
  ]
})

const funnelCards = computed(() => {
  const funnel = overview.value?.matchingFunnel
  if (!funnel) return []
  return [
    { label: 'Sem cobertura', value: funnel.semCobertura },
    { label: 'Elegiveis', value: funnel.elegiveis },
    { label: 'Selecionado', value: funnel.selecionado },
    { label: 'Encaminhado', value: funnel.encaminhado },
    { label: 'Aceito', value: funnel.aceito },
    { label: 'Recusado', value: funnel.recusado },
    { label: 'Timeout', value: funnel.timeout }
  ]
})

const rolloutCards = computed(() => {
  const rollout = overview.value?.rolloutHealth
  if (!rollout) return []
  return [
    { label: 'Tentativas', value: rollout.attemptsTotal },
    { label: 'Liberado', value: rollout.rolloutAllowed },
    { label: 'Bloqueado', value: rollout.rolloutBlocked },
    { label: 'Taxa bloqueada', value: `${rollout.blockedRatePct.toFixed(2)}%` }
  ]
})
</script>

<template>
  <div class="min-h-screen bg-neutral-100">
    <div class="dudu-container py-10">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">War Room</p>
          <h1 class="text-2xl font-extrabold text-neutral-900">Console operacional</h1>
          <p class="text-sm text-neutral-600">Acompanhamento de operacao, lucro operacional v1, previsao e alertas.</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700"
            :disabled="refreshing"
            @click="refreshWarRoom"
          >
            {{ refreshing ? 'Atualizando...' : 'Atualizar agora' }}
          </button>
          <button
            class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700"
            @click="logout"
          >
            Sair
          </button>
        </div>
      </div>

      <div class="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-soft">
        <div class="grid gap-3 md:grid-cols-4">
          <label class="text-sm text-neutral-700">
            Periodo
            <select v-model="selectedRange" class="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2">
              <option value="today">Hoje</option>
              <option value="7d">Ultimos 7 dias</option>
              <option value="30d">Ultimos 30 dias</option>
            </select>
          </label>
          <label class="text-sm text-neutral-700">
            Agrupamento de fluxo
            <select v-model="selectedGroupBy" class="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2">
              <option value="bairro">Bairro</option>
              <option value="cidade">Cidade</option>
              <option value="canal">Canal</option>
              <option value="hour">Hora</option>
            </select>
          </label>
          <label class="text-sm text-neutral-700">
            Horizonte previsao (dias)
            <input
              v-model.number="forecastHorizon"
              type="number"
              min="1"
              max="30"
              class="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2"
            >
          </label>
          <div class="text-xs text-neutral-500 md:pt-7">
            Fonte: Firebase + snapshots `ops_snapshots` e `ops_realtime`.
          </div>
        </div>
      </div>

      <p v-if="refreshError" class="mt-3 text-sm font-semibold text-red-600">{{ refreshError }}</p>
      <section class="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-soft">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-extrabold text-neutral-900">Conectividade Ops</h2>
          <button
            class="rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50"
            :disabled="!!connectivityPending"
            @click="refreshConnectivity"
          >
            {{ connectivityPending ? 'Verificando...' : 'Verificar' }}
          </button>
        </div>
        <p v-if="!connectivity" class="mt-2 text-xs text-neutral-500">Sem diagnostico no momento.</p>
        <div v-else class="mt-2 grid gap-2 text-xs md:grid-cols-3">
          <div class="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
            <p class="font-semibold text-neutral-900">Base URL</p>
            <p class="break-all text-neutral-600">{{ connectivity.apiBaseUrl }}</p>
          </div>
          <div class="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
            <p class="font-semibold text-neutral-900">Health</p>
            <p :class="connectivity.checks.health.ok ? 'text-emerald-700' : 'text-red-700'">
              {{ connectivity.checks.health.ok ? 'OK' : 'Falha' }} - {{ connectivity.checks.health.latencyMs ?? '-' }} ms
            </p>
            <p v-if="connectivity.checks.health.message" class="text-neutral-500">{{ connectivity.checks.health.message }}</p>
          </div>
          <div class="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
            <p class="font-semibold text-neutral-900">Overview</p>
            <p :class="connectivity.checks.overview.ok ? 'text-emerald-700' : 'text-red-700'">
              {{ connectivity.checks.overview.ok ? 'OK' : 'Falha' }} - {{ connectivity.checks.overview.latencyMs ?? '-' }} ms
            </p>
            <p v-if="connectivity.checks.overview.message" class="text-neutral-500">{{ connectivity.checks.overview.message }}</p>
          </div>
        </div>
      </section>
      <p v-if="pending" class="mt-4 text-sm text-neutral-500">Carregando dados...</p>
      <p v-else-if="error" class="mt-4 text-sm text-red-600">Erro ao carregar: {{ error?.message }}</p>

      <template v-else-if="overview">
        <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div v-for="card in kpiCards" :key="card.label" class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
            <p class="text-xs font-semibold text-neutral-500">{{ card.label }}</p>
            <p class="mt-2 text-2xl font-extrabold text-neutral-900">{{ card.value }}</p>
          </div>
        </div>

        <div class="mt-8 grid gap-6 lg:grid-cols-2">
          <section class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
            <h2 class="text-lg font-extrabold text-neutral-900">Top depositos</h2>
            <div class="mt-4 overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="text-left text-neutral-500">
                  <tr>
                    <th class="pb-2">Deposito</th>
                    <th class="pb-2">GMV</th>
                    <th class="pb-2">Entregues</th>
                    <th class="pb-2">Aceitacao</th>
                    <th class="pb-2">SLA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in overview.topDepositos" :key="item.depositoId" class="border-t border-neutral-100">
                    <td class="py-2 font-semibold text-neutral-900">{{ item.depositoNome }}</td>
                    <td class="py-2">{{ formatMoney(item.gmvCentavos) }}</td>
                    <td class="py-2">{{ item.deliveredOrders }}</td>
                    <td class="py-2">{{ formatPct(item.acceptanceRatePct) }}</td>
                    <td class="py-2">{{ item.slaAvgMinutes }} min</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
            <h2 class="text-lg font-extrabold text-neutral-900">Origem de fluxo</h2>
            <ul class="mt-4 space-y-2 text-sm text-neutral-700">
              <li
                v-for="point in overview.flow"
                :key="point.key"
                class="flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2"
              >
                <span class="font-medium text-neutral-900">{{ point.key }}</span>
                <span>{{ point.count }} pedidos - {{ formatMoney(point.gmvCentavos) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <div class="mt-8 grid gap-6 lg:grid-cols-2">
          <section class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
            <h2 class="text-lg font-extrabold text-neutral-900">Funil de intermediacao</h2>
            <div class="mt-4 grid gap-2 sm:grid-cols-2">
              <div
                v-for="item in funnelCards"
                :key="item.label"
                class="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm"
              >
                <p class="text-neutral-500">{{ item.label }}</p>
                <p class="font-extrabold text-neutral-900">{{ item.value }}</p>
              </div>
            </div>
          </section>

          <section class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
            <h2 class="text-lg font-extrabold text-neutral-900">Alertas operacionais</h2>
            <div class="mt-4 space-y-2">
              <div
                v-for="alert in overview.alerts"
                :key="`${alert.code}-${alert.title}`"
                class="rounded-xl border px-3 py-2 text-sm"
                :class="alert.severity === 'critical' ? 'border-red-200 bg-red-50 text-red-700' : alert.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-sky-200 bg-sky-50 text-sky-700'"
              >
                <p class="font-semibold">{{ alert.title }}: {{ alert.value }}</p>
                <p v-if="alert.note" class="text-xs">{{ alert.note }}</p>
              </div>
              <p v-if="overview.alerts.length === 0" class="text-sm text-neutral-500">
                Sem alertas ativos no periodo.
              </p>
            </div>
          </section>

          <section class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
            <h2 class="text-lg font-extrabold text-neutral-900">Saude do rollout</h2>
            <div class="mt-4 grid gap-2 sm:grid-cols-2">
              <div
                v-for="item in rolloutCards"
                :key="item.label"
                class="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm"
              >
                <p class="text-neutral-500">{{ item.label }}</p>
                <p class="font-extrabold text-neutral-900">{{ item.value }}</p>
              </div>
            </div>
            <ul class="mt-4 space-y-1 text-xs text-neutral-600">
              <li
                v-for="(count, reason) in overview.rolloutHealth.rolloutReasonCounts"
                :key="reason"
                class="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-2 py-1"
              >
                <span>{{ reason }}</span>
                <span class="font-semibold text-neutral-900">{{ count }}</span>
              </li>
            </ul>
          </section>

          <section class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
            <h2 class="text-lg font-extrabold text-neutral-900">Previsao ({{ overview.forecast.horizonDays }} dias)</h2>
            <ul class="mt-4 space-y-2 text-sm text-neutral-700">
              <li
                v-for="point in overview.forecast.points.slice(0, 7)"
                :key="point.date"
                class="flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2"
              >
                <span class="font-medium text-neutral-900">{{ point.date }}</span>
                <span>{{ point.ordersLow }}-{{ point.ordersHigh }} pedidos - {{ formatMoney(point.gmvBaseCentavos) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <section class="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
          <h2 class="text-lg font-extrabold text-neutral-900">Power BI</h2>
          <div class="mt-4">
            <iframe
              v-if="overview.powerBi.embedUrl"
              :src="overview.powerBi.embedUrl"
              title="Power BI War Room"
              class="h-[460px] w-full rounded-xl border border-neutral-100"
              loading="lazy"
              referrerpolicy="strict-origin-when-cross-origin"
            />
            <div v-else class="rounded-xl border border-neutral-100 bg-neutral-50 p-4 text-sm text-neutral-600">
              Embed Power BI nao configurado para este tenant. O painel nativo permanece ativo.
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

