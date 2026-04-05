<script setup lang="ts">
import type { Deposit, Lead, Order } from '#shared/types'

type AdminOverview = {
  leads: Lead[]
  deposits: Deposit[]
  orders: Order[]
}

definePageMeta({
  middleware: 'auth-admin'
})

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

const { data, pending, error } = await useFetch<AdminOverview>('/api/admin/overview')

const overview = computed<AdminOverview>(() => data.value || { leads: [], deposits: [], orders: [] })

const logout = async () => {
  await $fetch('/api/admin/logout', { method: 'POST' })
  await navigateTo('/admin/login')
}
</script>

<template>
  <div class="min-h-screen bg-neutral-100">
    <div class="dudu-container py-10">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-extrabold text-neutral-900">Painel admin</h1>
        <button
          class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700"
          @click="logout"
        >
          Sair
        </button>
      </div>

      <div class="mt-6 grid gap-4 md:grid-cols-3">
        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
          <p class="text-xs font-semibold text-neutral-500">Leads</p>
          <p class="mt-2 text-2xl font-extrabold text-neutral-900">{{ overview.leads.length }}</p>
        </div>
        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
          <p class="text-xs font-semibold text-neutral-500">Depósitos</p>
          <p class="mt-2 text-2xl font-extrabold text-neutral-900">{{ overview.deposits.length }}</p>
        </div>
        <div class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft">
          <p class="text-xs font-semibold text-neutral-500">Pedidos</p>
          <p class="mt-2 text-2xl font-extrabold text-neutral-900">{{ overview.orders.length }}</p>
        </div>
      </div>

      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
          <h2 class="text-lg font-extrabold text-neutral-900">Últimos leads</h2>
          <div v-if="pending" class="mt-4 text-sm text-neutral-500">Carregando...</div>
          <div v-else-if="error" class="mt-4 text-sm text-red-600">Erro ao carregar.</div>
          <div v-else class="mt-4 space-y-3">
            <div
              v-for="lead in overview.leads.slice(0, 5)"
              :key="lead.id"
              class="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-sm text-neutral-700"
            >
              <p class="font-semibold text-neutral-900">{{ lead.nome }}</p>
              <p>{{ lead.whatsapp }} - {{ lead.bairro }}</p>
            </div>
            <p v-if="overview.leads.length === 0" class="text-sm text-neutral-500">
              Nenhum lead cadastrado ainda.
            </p>
          </div>
        </div>
        <div class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft">
          <h2 class="text-lg font-extrabold text-neutral-900">Pedidos recentes</h2>
          <div class="mt-4 space-y-3">
            <div
              v-for="order in overview.orders.slice(0, 5)"
              :key="order.id"
              class="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-sm text-neutral-700"
            >
              <p class="font-semibold text-neutral-900">Pedido {{ order.id }}</p>
              <p>{{ order.bairro }} - {{ order.depositoNome }}</p>
            </div>
            <p v-if="overview.orders.length === 0" class="text-sm text-neutral-500">
              Nenhum pedido registrado ainda.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
