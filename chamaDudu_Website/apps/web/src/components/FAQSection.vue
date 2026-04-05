<script setup lang="ts">
import { faqItems } from '~/data/faq'
</script>

<template>
  <section id="faq" class="bg-white">
    <div class="dudu-container py-12">
      <h2 class="text-2xl font-extrabold text-neutral-900">Dúvidas socorrentes</h2>
      <div class="mt-6 grid gap-4 md:grid-cols-2">
        <div
          v-for="item in faqItems"
          :key="item.question"
          class="rounded-2xl border border-dudu-green/40 bg-white p-5 shadow-soft"
        >
          <span class="text-xs font-semibold uppercase tracking-wide text-dudu-green">
            {{ item.audience }}
          </span>
          <h3 class="mt-2 text-sm font-semibold text-neutral-900">{{ item.question }}</h3>
          <p class="mt-2 text-sm text-neutral-600">{{ item.answer }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
