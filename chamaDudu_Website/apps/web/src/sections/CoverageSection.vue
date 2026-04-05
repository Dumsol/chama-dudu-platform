<script setup lang="ts">
import { PhMapPin, PhArrowRight, PhCheckCircle } from '@phosphor-icons/vue'

const bairros = [
  'Paulista Centro', 'Janga', 'Pau Amarelo', 'Maranguape I e II',
  'Paratibe', 'Arthur Lundgren I e II', 'Fragoso', 'Jaguarana',
  'Mirueira', 'Conceição', 'Maria Farinha', 'Vila Torres Galvão',
  'Nobre', 'Jardim Paulista', 'Jaguaribe', 'Jardim Maranguape',
]
</script>

<template>
  <section class="bg-white py-16">
    <div class="dudu-container">
      <!-- Cabeçalho -->
      <div class="mb-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-[0.22em] text-dudu-green">Cobertura atual</p>
          <h2 class="mt-1 text-[28px] font-extrabold tracking-tight text-neutral-900">
            Onde o Dudu já chega 
          </h2>
          <p class="mt-1 text-sm text-neutral-600">
            16 bairros de <strong>Paulista-PE</strong> — e expandindo rápido.
          </p>
        </div>
        <NuxtLink
          to="/onde-funciona"
          class="inline-flex items-center gap-2 rounded-full border border-dudu-green/50 px-5 py-2.5 text-[13px] font-bold text-dudu-green transition hover:bg-dudu-green hover:text-white"
        >
          <PhMapPin :size="16" weight="fill" />
          Ver mapa completo
          <PhArrowRight :size="14" weight="bold" />
        </NuxtLink>
      </div>

      <!-- Grade de bairros -->
      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
        <div
          v-for="bairro in bairros"
          :key="bairro"
          class="flex items-center gap-2.5 rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-3 shadow-sm transition hover:border-dudu-green/40 hover:bg-emerald-50/60"
        >
          <PhCheckCircle :size="16" weight="fill" class="shrink-0 text-dudu-green" />
          <span class="text-[13px] font-semibold text-neutral-800">{{ bairro }}</span>
        </div>
      </div>

      <!-- CTA base -->
      <div class="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-dudu-green/25 bg-emerald-50/50 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p class="text-[15px] font-bold text-neutral-900">Não achou seu bairro?</p>
          <p class="mt-0.5 text-sm text-neutral-600">Manda um zap — a gente anota pra próxima expansão!</p>
        </div>
        <NuxtLink
          to="/onde-funciona"
          class="inline-flex shrink-0 items-center gap-2 rounded-full bg-dudu-green px-6 py-3 text-[13px] font-bold text-white shadow-[0_8px_20px_rgba(36,138,61,0.3)] transition hover:brightness-110"
        >
          <PhMapPin :size="16" weight="fill" />
          Ver mapa interativo
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
