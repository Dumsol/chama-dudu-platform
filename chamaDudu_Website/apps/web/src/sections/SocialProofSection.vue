<script setup lang="ts">
import { PhQuotes } from '@phosphor-icons/vue'
import { siteContent } from '~/content/pt-BR'
</script>

<template>
  <section class="bg-white">
    <div class="dudu-container py-12">
      <h2 class="text-2xl font-extrabold text-neutral-900">
        {{ siteContent.appPage.socialProofTitle }}
      </h2>
      <div class="mt-6 grid gap-4 md:grid-cols-2">
        <div
          v-for="item in siteContent.appPage.socialProof"
          :key="item.quote"
          class="rounded-2xl border border-dudu-green/40 bg-white p-6 shadow-soft"
        >
          <PhQuotes class="h-6 w-6 text-dudu-green" weight="fill" />
          <p class="mt-3 text-sm text-neutral-700">
            "{{ item.quote }}"
          </p>
          <p class="mt-4 text-xs font-semibold text-neutral-500">- {{ item.author }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
