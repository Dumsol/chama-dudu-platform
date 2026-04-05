<script setup lang="ts">
import {
  PhChatTeardropText,
  PhMapPin,
  PhShoppingBag,
  PhBell,
  PhArrowRight,
  PhWhatsappLogo,
  PhCheckCircle,
} from '@phosphor-icons/vue'

const steps = [
  {
    icon: PhChatTeardropText,
    label: 'Você manda uma mensagem',
    desc: 'Fale com o Dudu pelo WhatsApp dizendo o seu bairro e o que quer.',
  },
  {
    icon: PhMapPin,
    label: 'Dudu localiza quem está aberto',
    desc: 'O bot busca depósitos disponíveis agora no seu bairro em tempo real.',
  },
  {
    icon: PhShoppingBag,
    label: 'Escolhe e faz o pedido',
    desc: 'Seleciona o depósito e o Dudu encaminha o pedido direto pelo WhatsApp.',
  },
  {
    icon: PhBell,
    label: 'Recebe a confirmação',
    desc: 'O depósito confirma o pedido e você acompanha tudo no próprio WhatsApp.',
  },
]

const highlights = [
  'Sem app pra baixar',
  'Sem cadastro complicado',
  'Resposta em segundos',
  'Funciona 24h por dia',
]
</script>

<template>
  <section id="como-funciona" class="bg-white">
    <div class="dudu-container pt-10 pb-16 lg:pt-[56px] lg:pb-[88px]">

      <!-- Cabeçalho da seção -->
      <div class="text-center">
        <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-dudu-green">Simples assim</p>
        <h2 class="mt-2 text-[32px] font-black tracking-tight text-neutral-900 md:text-[38px]">
          Como o Dudu funciona
        </h2>
        <p class="mx-auto mt-3 max-w-[520px] text-[16px] leading-relaxed text-neutral-600">
          Do bairro até a gelada na sua mão em minutos — tudo dentro do WhatsApp.
        </p>
      </div>

      <!-- Passos em timeline -->
      <div class="relative mt-14 grid gap-0 md:grid-cols-4">
        <!-- Linha conectora (desktop) -->
        <div class="absolute top-[26px] left-[12.5%] right-[12.5%] hidden h-[2px] bg-gradient-to-r from-dudu-green/30 via-dudu-green/60 to-dudu-green/30 md:block" />

        <div
          v-for="(step, i) in steps"
          :key="step.label"
          class="relative flex flex-col items-center text-center px-4"
        >
          <!-- Número + ícone -->
          <div class="relative mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-dudu-green shadow-[0_8px_24px_rgba(36,138,61,0.35)] ring-4 ring-white z-10">
            <component :is="step.icon" :size="26" weight="fill" class="text-white" />
            <span class="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-black text-white">
              {{ i + 1 }}
            </span>
          </div>
          <h3 class="text-[14px] font-extrabold text-neutral-900 leading-tight">{{ step.label }}</h3>
          <p class="mt-1.5 text-[12px] leading-relaxed text-neutral-500">{{ step.desc }}</p>
        </div>
      </div>

      <!-- Destaques + CTAs -->
      <div class="mt-14 grid gap-8 rounded-3xl border border-dudu-green/20 bg-emerald-50/50 p-8 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p class="text-[13px] font-bold uppercase tracking-widest text-dudu-green">Por que funciona</p>
          <ul class="mt-4 grid gap-2 sm:grid-cols-2">
            <li
              v-for="h in highlights"
              :key="h"
              class="flex items-center gap-2.5 text-[14px] font-semibold text-neutral-800"
            >
              <PhCheckCircle :size="18" weight="fill" class="shrink-0 text-dudu-green" />
              {{ h }}
            </li>
          </ul>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row lg:flex-col">
          <a
            href="https://wa.me/5581985740561"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center justify-center gap-2 rounded-full bg-dudu-green px-6 py-3 text-[14px] font-bold text-white shadow-[0_10px_28px_rgba(36,138,61,0.35)] transition hover:brightness-110"
          >
            <PhWhatsappLogo :size="18" weight="fill" />
            WhatsApp (81) 98574-0561
          </a>
          <NuxtLink
            to="/app"
            class="inline-flex items-center justify-center gap-2 rounded-full border border-dudu-green/50 px-6 py-3 text-[14px] font-bold text-dudu-green transition hover:bg-dudu-green hover:text-white"
          >
            Entender o App completo
            <PhArrowRight :size="16" weight="bold" />
          </NuxtLink>
        </div>
      </div>

    </div>
  </section>
</template>
