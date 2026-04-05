<script setup lang="ts">
import { PhQuotes } from '@phosphor-icons/vue'
</script>

<template>
  <section class="bg-white">
    <div class="dudu-container py-12">
      <h2 class="text-2xl font-extrabold text-neutral-900">
        Depoimentos / Prova social
      </h2>
      <div class="mt-6 grid gap-4 md:grid-cols-2">
        <div class="rounded-2xl border border-dudu-green/40 bg-white p-6 shadow-soft">
          <PhQuotes class="h-6 w-6 text-dudu-green" weight="fill" />
          <p class="mt-3 text-sm text-neutral-700">
            "Agora eu falo o bairro e já vejo quem tá aberto. Quando chega na madrugada, o Dudu salva."
          </p>
          <p class="mt-4 text-xs font-semibold text-neutral-500">- André, cliente</p>
        </div>
        <div class="rounded-2xl border border-dudu-green/40 bg-white p-6 shadow-soft">
          <PhQuotes class="h-6 w-6 text-dudu-green" weight="fill" />
          <p class="mt-3 text-sm text-neutral-700">
            "O pedido chega prontinho no WhatsApp, sem app extra. Abri, fechei, resolvi."
          </p>
          <p class="mt-4 text-xs font-semibold text-neutral-500">- Lívia, depósito</p>
        </div>
      </div>
    </div>
  </section>
</template>
