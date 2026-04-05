<script setup lang="ts">
import { computed } from 'vue'
import { PhWhatsappLogo } from '@phosphor-icons/vue'

const config = useRuntimeConfig()
const whatsappUrl = computed(() => config.public.whatsappUrl || 'https://wa.me/5581985740561')
</script>

<template>
  <footer class="bg-[#0B0C0C] text-white">
    <div class="dudu-container py-10">
      <div class="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <NuxtImg
              src="/images/logo.webp"
              alt="Logo Chama o Dudu"
              class="h-20 w-auto brightness-110"
              width="360"
              height="360"
              loading="lazy"
            />
            <div>
              <p class="text-[24px] font-extrabold leading-none tracking-tight text-[#22C55E] [text-shadow:0_0_18px_rgba(34,197,94,0.5)]">
                Chama Dudu
              </p>
              <p class="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Depositos no WhatsApp
              </p>
            </div>
          </div>
          <p class="text-sm text-white/70">Chama Dudu salva na madrugada.</p>
        </div>
        <div class="flex flex-wrap gap-6 text-sm text-white/70">
          <NuxtLink to="/app" class="transition hover:text-white">App</NuxtLink>
          <NuxtLink to="/termos" class="transition hover:text-white">Termos de uso</NuxtLink>
          <NuxtLink to="/privacidade" class="transition hover:text-white">Política de privacidade</NuxtLink>
          <NuxtLink to="/onde-funciona" class="transition hover:text-white">Onde funciona</NuxtLink>
          <a :href="whatsappUrl" target="_blank" rel="noopener" class="transition hover:text-white">
            Contato no WhatsApp
          </a>
          <NuxtLink to="/sitemap" class="transition hover:text-white">Sitemap</NuxtLink>
        </div>
        <div class="flex items-center gap-3 text-white/70">
          <ClientOnly>
            <a :href="whatsappUrl" aria-label="Abrir WhatsApp do Chama o Dudu" class="rounded-full border border-white/20 p-2">
              <PhWhatsappLogo class="h-4 w-4" weight="fill" />
            </a>
          </ClientOnly>
        </div>
      </div>
      <p class="mt-6 text-xs text-white/40">Chama o Dudu. Todos os direitos reservados. CNPJ:63667841000177 Um Produto da Kosh Sistemas</p>
    </div>
  </footer>
</template>
