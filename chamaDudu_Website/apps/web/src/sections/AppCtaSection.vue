<script setup lang="ts">
import { siteContent } from '~/content/pt-BR'

const config = useRuntimeConfig()
</script>

<template>
  <section class="bg-white">
    <div class="dudu-container pb-14">
      <div class="rounded-2xl bg-neutral-900 p-6 text-white shadow-lg shadow-slate-900/20">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-200">Pronto para operar?</p>
            <h3 class="text-2xl font-extrabold">{{ siteContent.appPage.ctaTitle }}</h3>
            <p class="mt-2 text-sm text-white/80">{{ siteContent.appPage.ctaDescription }}</p>
          </div>
          <div class="flex flex-wrap gap-3">
            <a
              :href="config.public.whatsappUrl"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center justify-center rounded-full bg-dudu-green px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
            >
              {{ siteContent.ctaLabel }}
            </a>
            <a
              href="#parceiro"
              class="inline-flex items-center justify-center rounded-full border border-white/40 px-5 py-3 text-sm font-semibold text-white"
            >
              Pré-cadastro de depósito
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
