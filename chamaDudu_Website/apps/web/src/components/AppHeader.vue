<script setup lang="ts">
import { PhWhatsappLogo, PhSignIn, PhShieldCheck } from '@phosphor-icons/vue'
import { siteContent } from '~/content/pt-BR'

const config = useRuntimeConfig()
</script>

<template>
  <header class="sticky top-0 z-50 border-b border-dudu-green/20 bg-white/85 shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur-md">
    <div class="dudu-container flex items-center justify-between py-2.5">
      <NuxtLink to="/" class="flex items-center gap-3" aria-label="Voltar para a pagina inicial">
        <NuxtImg
          src="/images/logo.webp"
          alt="Logo Chama o Dudu"
          class="h-[72px] w-auto md:h-[80px]"
          width="360"
          height="360"
          loading="eager"
        />
        <div class="hidden sm:block">
          <p class="text-[22px] font-black tracking-tight text-[#22C55E]">
            Chama Dudu
          </p>
          <p class="mt-[-4px] text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-700">
            Delivery no WhatsApp
          </p>
        </div>
      </NuxtLink>

      <nav class="hidden items-center gap-6 text-[13px] font-bold text-neutral-600 lg:flex">
        <NuxtLink
          v-for="item in siteContent.nav"
          :key="item.to"
          :to="item.to"
          class="transition hover:text-dudu-green"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="flex items-center gap-2 sm:gap-3">
        <!-- Botão Admin / War Room -->
        <NuxtLink
          to="/admin/login"
          class="hidden sm:inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-[12px] font-bold text-neutral-600 transition hover:bg-neutral-50 hover:border-neutral-300"
          title="Acesso ao War Room / CRM"
        >
          <PhShieldCheck :size="16" weight="fill" class="text-neutral-400" />
          <span>Painel</span>
        </NuxtLink>

        <!-- CTA Principal -->
        <a
          :href="config.public.whatsappUrl"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-2 rounded-full bg-dudu-green px-5 py-2 text-[12px] font-bold text-white shadow-lg transition hover:brightness-110 active:scale-95 sm:px-6 sm:py-2.5 sm:text-[13px]"
        >
          <PhWhatsappLogo :size="18" weight="fill" />
          <span class="hidden xs:inline">{{ siteContent.ctaLabel }}</span>
          <span class="xs:hidden">Chamar</span>
        </a>
      </div>
    </div>
  </header>
</template>

