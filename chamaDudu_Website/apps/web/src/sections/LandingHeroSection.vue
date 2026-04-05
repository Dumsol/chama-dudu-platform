<script setup lang="ts">
import { PhCircleWavyCheck, PhWhatsappLogo, PhMapPin, PhArrowRight } from '@phosphor-icons/vue'
import { siteContent } from '~/content/pt-BR'

const config = useRuntimeConfig()
</script>

<template>
  <!--
    hero-fullbleed: min-height = 100dvh (sem cortes)
    hero-glow: bg escuro + gradientes verdes sutis
    Sem overflow ou barra residual: hero-fade-out adiciona transição suave na base
  -->
  <section
    class="hero-fullbleed hero-glow hero-fade-out relative w-full overflow-hidden text-white"
    data-testid="hero-section"
  >
    <!-- Overlay esquerdo para legibilidade do texto -->
    <div class="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,rgba(2,13,8,0.97)_0%,rgba(2,13,8,0.85)_45%,rgba(2,13,8,0.3)_70%,transparent_100%)]" />

    <div class="dudu-container relative z-10 grid min-h-[inherit] items-center gap-8 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:py-0">
      <!-- Coluna de texto -->
      <div class="max-w-[620px]" data-testid="hero-copy">

        <!-- Badge -->
        <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-900/30 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-200 backdrop-blur-sm">
          <PhWhatsappLogo :size="14" weight="fill" class="text-emerald-400" />
          WhatsApp · Fácil de usar!
        </span>

        <!-- Headline — suporte a **negrito** via replace, renderizado em cor de destaque -->
        <h1
          class="hero-bold-highlight mt-5 text-[42px] font-black leading-[1.08] tracking-tight md:text-[56px]"
          v-html="siteContent.landing.headline.replace(/\*\*(.*?)\*\*/g, '<span class=\'text-emerald-400\'>$1</span>')"
        />

        <!-- Subtítulo -->
        <p class="mt-5 max-w-[520px] text-[18px] leading-[1.65] text-white/80">
          {{ siteContent.landing.subheadline }}
        </p>

        <!-- Lista de diferenciais -->
        <ul class="mt-7 space-y-3 text-[15px] font-semibold text-white/90">
          <li class="flex items-center gap-3">
            <PhCircleWavyCheck :size="20" weight="fill" class="shrink-0 text-emerald-400" />
            Resposta em segundos — sem espera
          </li>
          <li class="flex items-center gap-3">
            <PhCircleWavyCheck :size="20" weight="fill" class="shrink-0 text-emerald-400" />
            Ver quem está aberto <strong>agora</strong> no seu bairro
          </li>
          <li class="flex items-center gap-3">
            <PhCircleWavyCheck :size="20" weight="fill" class="shrink-0 text-emerald-400" />
            Funciona direto no WhatsApp — sem app
          </li>
        </ul>

        <!-- CTAs -->
        <div class="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <!-- CTA principal -->
          <a
            :href="config.public.whatsappUrl"
            target="_blank"
            rel="noopener"
            class="inline-flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-full bg-emerald-500 px-8 text-[15px] font-bold text-white shadow-[0_16px_36px_rgba(16,185,129,0.35)] transition hover:scale-[1.03] hover:bg-emerald-400 active:scale-[0.97] sm:w-auto"
            data-testid="hero-cta-primary"
          >
            <PhWhatsappLogo :size="22" weight="bold" />
            {{ siteContent.ctaLabel }}
          </a>

          <!-- CTA secundário: onde funciona -->
          <NuxtLink
            to="/onde-funciona"
            class="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full border border-white/30 bg-white/8 px-7 text-[14px] font-bold text-white/90 backdrop-blur-sm transition hover:border-white/50 hover:bg-white/15 sm:w-auto"
            data-testid="hero-cta-area"
          >
            <PhMapPin :size="18" weight="fill" class="text-emerald-400" />
            Ver onde funciona
          </NuxtLink>
        </div>

        <p class="mt-4 text-[12px] font-medium uppercase tracking-widest text-white/45">
          Sem cadastro · Sem complicação · Paulista-PE
        </p>
      </div>

      <!-- Coluna da imagem – desktop -->
      <div class="relative hidden h-[90vh] max-h-[680px] items-center justify-center lg:flex" data-testid="hero-visual">
        <!-- Glow atrás do mascote -->
        <div class="absolute inset-[10%] rounded-full bg-emerald-600/15 blur-[80px]" />
        <picture class="relative z-10 flex h-full w-full items-end justify-center">
          <source srcset="/images/hero-mascot.webp" type="image/webp">
          <img
            src="/images/hero-mascot.png"
            alt="Mascote do Chama o Dudu segurando celular com WhatsApp"
            class="h-full w-auto max-w-full select-none object-contain object-bottom drop-shadow-2xl"
            data-testid="hero-mascot-desktop"
            width="920"
            height="920"
            loading="eager"
            decoding="async"
            fetchpriority="high"
          >
        </picture>
      </div>

      <!-- Mascote – mobile -->
      <div class="mt-2 flex justify-center lg:hidden">
        <div class="relative w-[280px] sm:w-[340px]">
          <div class="absolute inset-x-4 bottom-0 h-24 rounded-full bg-emerald-500/12 blur-[40px]" />
          <picture class="relative z-10">
            <source srcset="/images/hero-mascot.webp" type="image/webp">
            <img
              src="/images/hero-mascot.png"
              alt="Mascote do Chama o Dudu segurando celular"
              class="w-full select-none object-contain"
              data-testid="hero-mascot-mobile"
              width="920"
              height="920"
              loading="eager"
              decoding="async"
            >
          </picture>
        </div>
      </div>
    </div>
  </section>
</template>
