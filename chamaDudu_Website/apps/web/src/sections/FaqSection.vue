<script setup lang="ts">
import { siteContent } from '~/content/pt-BR'
</script>

<template>
  <section id="faq" class="bg-white">
    <div class="dudu-container py-12">
      <h2 class="text-2xl font-extrabold text-neutral-900">FAQ</h2>
      <div class="mt-6 grid gap-4 md:grid-cols-2">
        <div
          v-for="item in siteContent.faq"
          :key="item.question"
          class="rounded-2xl border border-dudu-green/40 bg-white p-5 shadow-soft"
        >
          <h3 class="text-sm font-semibold text-neutral-900">{{ item.question }}</h3>
          <p class="mt-2 text-sm text-neutral-600">{{ item.answer }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
