<script setup lang="ts">
import {
  PhStorefront,
  PhWhatsappLogo,
  PhChartLineUp,
  PhCheckCircle,
  PhArrowRight,
  PhStar,
  PhHandshake,
  PhClock,
} from '@phosphor-icons/vue'

const vantagens = [
  {
    icon: PhWhatsappLogo,
    title: 'Pedidos chegam pelo WhatsApp',
    desc: 'Sem sistema complicado. Você recebe o pedido pronto direto no WhatsApp do seu depósito.',
  },
  {
    icon: PhClock,
    title: 'Abrir e fechar em segundos',
    desc: 'Manda "abrir" ou "fechar" pelo WhatsApp. O Dudu atualiza seu status automaticamente.',
  },
  {
    icon: PhChartLineUp,
    title: 'Mais visibilidade, mais vendas',
    desc: 'Clientes que antes não te conheciam passam a te encontrar toda vez que buscam bebida no bairro.',
  },
  {
    icon: PhHandshake,
    title: 'Sem mensalidade no beta',
    desc: 'Durante o período beta, a taxa cabe no seu bolso. Você só paga quando a gente crescer junto.',
  },
]

const steps = [
  { n: '01', title: 'Faz o pré-cadastro', desc: 'Preenche o formulário ao lado com nome, WhatsApp e bairro do depósito.' },
  { n: '02', title: 'A gente ativa', desc: 'Validamos seus dados e ativamos seu depósito no sistema do Dudu.' },
  { n: '03', title: 'Abre pelo WhatsApp', desc: 'Manda "abrir" no WhatsApp e começa a receber clientes do seu bairro.' },
  { n: '04', title: 'Recebe e entrega', desc: 'Pedido chega, você confirma e entrega. Simples assim.' },
]
</script>

<template>
  <section id="parceiro" class="bg-white">
    <div class="dudu-container py-16 lg:py-[88px]">

      <!-- Badge + título -->
      <div class="text-center">
        <span class="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-dudu-green">
          <PhStorefront :size="14" weight="fill" />
          Para depósitos de bairro
        </span>
        <h2 class="mt-4 text-[32px] font-black tracking-tight text-neutral-900 md:text-[40px]">
          Coloque seu depósito no mapa.<br class="hidden sm:block">
          <span class="text-dudu-green">Sem complicação.</span>
        </h2>
        <p class="mx-auto mt-3 max-w-[560px] text-[16px] leading-relaxed text-neutral-600">
          Enquanto outros depósitos ficam esperando o telefone tocar, o seu aparece automaticamente para clientes do bairro que buscam bebida agora.
        </p>
      </div>

      <!-- Vantagens -->
      <div class="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="v in vantagens"
          :key="v.title"
          class="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-6 transition hover:border-dudu-green/40 hover:bg-emerald-50"
        >
          <div class="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
            <component :is="v.icon" :size="22" weight="fill" class="text-dudu-green" />
          </div>
          <h3 class="text-[15px] font-extrabold text-neutral-900">{{ v.title }}</h3>
          <p class="mt-1.5 text-[13px] leading-relaxed text-neutral-600">{{ v.desc }}</p>
        </div>
      </div>

      <!-- Como entrar: passos + formulário -->
      <div class="mt-16 grid gap-10 lg:grid-cols-[1fr_420px] lg:items-start">

        <!-- Passos -->
        <div>
          <p class="text-[13px] font-bold uppercase tracking-widest text-dudu-green">Como entrar</p>
          <h3 class="mt-2 text-[24px] font-black text-neutral-900">4 passos para estar no ar</h3>
          <div class="mt-6 space-y-5">
            <div
              v-for="s in steps"
              :key="s.n"
              class="flex gap-5"
            >
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[14px] font-black text-white">
                {{ s.n }}
              </div>
              <div class="pt-1">
                <p class="text-[15px] font-extrabold text-neutral-900">{{ s.title }}</p>
                <p class="mt-1 text-[13px] leading-relaxed text-neutral-600">{{ s.desc }}</p>
              </div>
            </div>
          </div>

          <!-- Prova social -->
          <div class="mt-8 rounded-2xl border border-dudu-green/20 bg-emerald-50/50 p-5">
            <div class="flex items-start gap-3">
              <PhStar :size="20" weight="fill" class="shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p class="text-[14px] font-bold text-neutral-900">"Minha vendas subiram no primeiro dia"</p>
                <p class="mt-1 text-[12px] text-neutral-600">— Depósito parceiro, Janga-PE</p>
              </div>
            </div>
          </div>

          <NuxtLink
            to="/app"
            class="mt-6 inline-flex items-center gap-2 text-[13px] font-bold text-dudu-green underline underline-offset-4 transition hover:text-emerald-700"
          >
            Ver explicação completa do sistema
            <PhArrowRight :size="14" weight="bold" />
          </NuxtLink>
        </div>

        <!-- Formulário de pré-cadastro -->
        <div class="rounded-3xl border-2 border-dudu-green/40 bg-white p-8 shadow-[0_20px_60px_rgba(36,138,61,0.12)]">
          <div class="mb-5 flex items-center gap-2">
            <PhCheckCircle :size="22" weight="fill" class="text-dudu-green" />
            <p class="text-[16px] font-extrabold text-neutral-900">Pré-cadastro gratuito</p>
          </div>
          <PreCadastroForm />
          <p class="mt-4 text-[11px] text-neutral-500 text-center">
            Seus dados são usados apenas para ativação. Nada de spam.
          </p>
        </div>

      </div>
    </div>
  </section>
</template>
