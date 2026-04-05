<script setup lang="ts">
import { computed } from 'vue'
import { PhWhatsappLogo } from '@phosphor-icons/vue'

const config = useRuntimeConfig()
const route = useRoute()

const visibleRoutes = new Set([
  '/',
  '/app',
  '/cliente',
  '/onde-funciona',
  '/termos',
  '/privacidade'
])

const showCtas = computed(() => visibleRoutes.has(route.path))
const whatsappUrl = computed(() => config.public.whatsappUrl || 'https://wa.me/5500000000000')
</script>

<template>
  <ClientOnly>
    <template v-if="showCtas">
      <a
        id="whatsapp-floating-button"
        :href="whatsappUrl"
        target="_blank"
        rel="noopener"
        aria-label="Chamar no WhatsApp"
        class="fixed right-4 bottom-24 z-[70] inline-flex h-14 w-14 items-center justify-center rounded-full bg-dudu-green text-white shadow-[0_16px_34px_rgba(22,163,74,0.45)] transition hover:brightness-110 md:right-6 md:bottom-6"
      >
        <PhWhatsappLogo class="h-7 w-7" weight="fill" />
      </a>

      <div
        id="mobile-sticky-cta"
        class="fixed inset-x-0 bottom-0 z-[65] border-t border-dudu-green/25 bg-white/95 px-3 py-3 backdrop-blur md:hidden"
      >
        <div class="mx-auto flex w-full max-w-[540px] gap-2">
          <a
            :href="whatsappUrl"
            target="_blank"
            rel="noopener"
            class="inline-flex min-h-[46px] flex-1 items-center justify-center rounded-full bg-dudu-green px-4 text-xs font-semibold text-white shadow-[0_10px_24px_rgba(22,163,74,0.34)]"
          >
            Chamar no WhatsApp
          </a>
          <NuxtLink
            to="/#parceiro"
            class="inline-flex min-h-[46px] flex-1 items-center justify-center rounded-full border border-dudu-green/55 px-4 text-xs font-semibold text-dudu-green"
          >
            Cadastrar deposito
          </NuxtLink>
        </div>
      </div>
    </template>
  </ClientOnly>
</template>
