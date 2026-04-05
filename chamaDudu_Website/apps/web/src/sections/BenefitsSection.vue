<script setup lang="ts">
import {
  PhLightning,
  PhMapPin,
  PhWhatsappLogo,
  PhCurrencyDollar,
  PhShieldCheck,
  PhClock,
  PhArrowRight,
} from '@phosphor-icons/vue'

const benefits = [
  {
    icon: PhLightning,
    title: 'Resposta em segundos',
    desc: 'Sem espera, sem musiquinha de cold call. O Dudu responde imediatamente.',
    color: 'text-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
  },
  {
    icon: PhMapPin,
    title: 'Seu bairro, agora',
    desc: 'Lista só os depósitos abertos no seu bairro neste exato momento.',
    color: 'text-dudu-green',
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
  },
  {
    icon: PhWhatsappLogo,
    title: 'Tudo no WhatsApp',
    desc: 'Sem baixar app. Sem criar conta. Você já tem o WhatsApp — é só chamar.',
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-100',
  },
  {
    icon: PhCurrencyDollar,
    title: 'Sem app chato para baixar',
    desc: 'O cliente não paga nada. O serviço é sempre gratuito pra quem pede.',
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
  },
  {
    icon: PhShieldCheck,
    title: 'Sem exposição de dados',
    desc: 'O Dudu não guarda cartão de crédito nem dados bancários. Só o essencial.',
    color: 'text-violet-500',
    bg: 'bg-violet-50',
    border: 'border-violet-100',
  },
  {
    icon: PhClock,
    title: 'Disponível a qualquer hora',
    desc: 'O bot não descansa. Sempre que você precisar, o Dudu está lá.',
    color: 'text-rose-500',
    bg: 'bg-rose-50',
    border: 'border-rose-100',
  },
]
</script>

<template>
  <section id="beneficios" class="bg-neutral-50/80">
    <div class="dudu-container py-16 lg:py-[80px]">

      <!-- Cabeçalho -->
      <div class="text-center">
        <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-dudu-green">Por que o Dudu?</p>
        <h2 class="mt-2 text-[32px] font-black tracking-tight text-neutral-900 md:text-[38px]">
          Tudo que você sempre quis num delivery
        </h2>
        <p class="mx-auto mt-3 max-w-[480px] text-[16px] leading-relaxed text-neutral-600">
          Simples, rápido e no canal que você já usa todo dia.
        </p>
      </div>

      <!-- Grade de benefícios -->
      <div class="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="b in benefits"
          :key="b.title"
          class="group relative overflow-hidden rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(0,0,0,0.1)]"
          :class="b.border"
        >
          <!-- Ícone -->
          <div class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl" :class="b.bg">
            <component :is="b.icon" :size="26" weight="fill" :class="b.color" />
          </div>
          <h3 class="text-[16px] font-extrabold text-neutral-900">{{ b.title }}</h3>
          <p class="mt-2 text-[13px] leading-relaxed text-neutral-600">{{ b.desc }}</p>
          <!-- Detalhe decorativo -->
          <div class="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full opacity-10 transition group-hover:opacity-20" :class="b.bg" />
        </article>
      </div>

      <!-- CTA base -->
      <div class="mt-10 text-center">
        <NuxtLink
          to="/app"
          class="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-8 py-3.5 text-[14px] font-bold text-white transition hover:bg-dudu-green"
        >
          Ver como funciona pra você
          <PhArrowRight :size="16" weight="bold" />
        </NuxtLink>
      </div>

    </div>
  </section>
</template>
