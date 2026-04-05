<script setup lang="ts">
import { PhShieldWarning } from '@phosphor-icons/vue'

const config = useRuntimeConfig()
const route = useRoute()
const requestUrl = useRequestURL()

const canonicalUrl = computed(() => `${requestUrl.origin}${route.path}`)

useSeoMeta({
  title: 'Cliente | Chama Dudu',
  description: 'Cliente chama no WhatsApp, o Dudu mostra quem tá aberto e envia o pedido pronto.',
  ogTitle: 'Cliente | Chama Dudu',
  ogDescription: 'Sem app. Você chama no WhatsApp e resolve com o Dudu.',
  ogImage: `${requestUrl.origin}/og.png`,
  twitterCard: 'summary_large_image',
  twitterTitle: 'Cliente | Chama Dudu',
  twitterDescription: 'Chama no WhatsApp, Dudu encaminha o pedido.',
  twitterImage: `${requestUrl.origin}/og.png`
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl.value }]
})

const coverageAreas = [
  'Bairro Jardim das Palmeiras',
  'Vila Aurora',
  'Centro',
  'Ponte Preta',
  'Recanto das Flores'
]

const benefits = [
  'Menos tempo perdido perguntando e esperando resposta.',
  'Resolve mais rápido quando é noite.',
  'Você vê quem tá aberto sem caçar.'
]

const faqList = [
  { question: 'Precisa baixar app?', answer: 'Não precisa, tudo acontece pelo WhatsApp.' },
  { question: 'Tem taxa pra mim?', answer: 'Só R$ 0,99 na entrega, quando houver cobrança.' },
  { question: 'Entrega ou retirada?', answer: 'Você decide na conversa com o depósito.' },
  { question: 'Funciona em todo lugar?', answer: 'Atendemos bairros ativos. Veja na lista.' },
  { question: 'E se ninguém responder?', answer: 'O Dudu avisa que está procurando e sugere esperar.' },
  { question: 'Como sei quem tá aberto?', answer: 'O Dudu mostra o depósito disponível com status atualizado.' },
  { question: 'O que dá pra pedir?', answer: 'Qualquer bebida ou combo que o depósito oferecer no momento.' }
]

const testimonials = [
  { text: 'Agora sei quem tá aberto sem perder tempo.', from: 'TODO: Nome/cliente' },
  { text: 'Chega pedido pronto, só separar e entregar.', from: 'TODO: Nome/depósito' }
]

const coverageForm = reactive({
  whatsapp: '',
  nome: '',
  bairro: ''
})

const formStatus = ref('')

const handleCoverageSubmit = (event: Event) => {
  event.preventDefault()
  formStatus.value = 'Obrigado! Avisamos quando chegar ao teu bairro.'
  // TODO: conectar com endpoint de leads/cobertura para avisar os bairros novos.
}
</script>

<template>
  <div class="min-h-screen bg-neutral-50">
    <div class="mx-auto w-full max-w-[1200px] px-6 py-8 sm:px-8 lg:px-10">
      <AppHeader />
      <main class="space-y-16 py-8">
        <!-- HERO -->
        <section class="rounded-[28px] bg-white/80 p-6 shadow-lg shadow-green-900/5 sm:p-10">
          <div class="flex flex-col gap-6 lg:flex-row lg:items-center">
            <div class="flex-1">
              <p class="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Cliente</p>
              <h1 class="mt-3 text-3xl font-extrabold leading-tight text-neutral-900 sm:text-4xl">
                Descobre quem tá aberto no teu bairro agora
              </h1>
              <p class="mt-3 text-lg text-neutral-700">
                Sem app. Você chama no WhatsApp e resolve.
              </p>
              <div class="mt-6 flex flex-wrap gap-3">
                <a
                  :href="config.public.whatsappUrl"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center justify-center rounded-full bg-dudu-green px-6 py-3 text-base font-semibold text-white shadow-[0_12px_30px_rgba(34,139,78,0.35)] transition hover:brightness-110"
                >
                  Chamar no WhatsApp
                </a>
                <a href="#cobertura" class="inline-flex items-center justify-center rounded-full border border-neutral-300 px-6 py-3 text-base font-semibold text-neutral-900 transition hover:border-neutral-900">
                  Ver cobertura
                </a>
              </div>
            </div>
            <div class="flex flex-col items-start gap-3 text-sm text-neutral-600">
              <span class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                <PhShieldWarning class="text-emerald-500" size="18" weight="fill" />
                18+
              </span>
              <p>Chama Dudu salva na madrugada. Pedido rápido e sem enrolação.</p>
            </div>
          </div>
        </section>

        <!-- COMO FUNCIONA -->
        <section class="rounded-2xl bg-white p-6 shadow-lg shadow-slate-900/5">
          <h2 class="text-2xl font-extrabold text-neutral-900">Como funciona</h2>
          <div class="mt-6 grid gap-4 sm:grid-cols-3">
            <div class="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <p class="text-sm font-semibold text-neutral-900">Você chama no WhatsApp e diz teu bairro</p>
            </div>
            <div class="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <p class="text-sm font-semibold text-neutral-900">O Dudu encontra quem tá aberto e monta teu pedido</p>
            </div>
            <div class="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <p class="text-sm font-semibold text-neutral-900">Você confirma e recebe/retira</p>
            </div>
          </div>
        </section>

        <!-- COBERTURA -->
        <section id="cobertura" class="rounded-2xl bg-white p-6 shadow-lg shadow-slate-900/5">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-2xl font-extrabold text-neutral-900">Cobertura</h2>
              <p class="mt-1 text-sm text-neutral-600">Bairros que já tem Dudu ativo.</p>
            </div>
            <NuxtLink to="/onde-funciona" class="text-sm font-semibold text-dudu-green underline">
              Ver mapa
            </NuxtLink>
          </div>
          <div class="mt-6 grid gap-3 sm:grid-cols-2">
            <div v-for="area in coverageAreas" :key="area" class="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              {{ area }}
            </div>
          </div>
          <div class="mt-8 rounded-2xl border border-dudu-green/30 bg-emerald-50/60 p-5">
            <p class="text-sm font-semibold text-neutral-900">Não tá na lista? Deixa teu WhatsApp que a gente avisa quando chegar.</p>
            <form class="mt-4 flex flex-col gap-3 sm:max-w-md" @submit="handleCoverageSubmit">
              <label class="text-xs font-semibold text-neutral-600">
                WhatsApp *
                <input
                  v-model="coverageForm.whatsapp"
                  required
                  class="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-dudu-green focus:outline-none"
                >
              </label>
              <label class="text-xs font-semibold text-neutral-600">
                Nome
                <input
                  v-model="coverageForm.nome"
                  class="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-dudu-green focus:outline-none"
                >
              </label>
              <label class="text-xs font-semibold text-neutral-600">
                Bairro
                <input
                  v-model="coverageForm.bairro"
                  class="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-dudu-green focus:outline-none"
                >
              </label>
              <button
                type="submit"
                class="inline-flex items-center justify-center rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
              >
                Avisar quando chegar
              </button>
            </form>
            <p v-if="formStatus" class="mt-3 text-xs text-neutral-600">{{ formStatus }}</p>
          </div>
        </section>

        <!-- REGRAS -->
        <section class="rounded-2xl bg-white p-6 shadow-lg shadow-slate-900/5">
          <h2 class="text-2xl font-extrabold text-neutral-900">Regras rápidas</h2>
          <ul class="mt-4 space-y-2 text-sm text-neutral-700">
            <li>Preço e entrega dependem do depósito do bairro.</li>
            <li>Se não tiver ninguém aberto agora, o Dudu avisa.</li>
            <li>Contato é só pra pedido. Sem spam.</li>
            <li>Legal 18+ (veja o aviso no topo).</li>
          </ul>
        </section>

        <!-- BENEFÍCIOS -->
        <section class="rounded-2xl bg-white p-6 shadow-lg shadow-slate-900/5">
          <h2 class="text-2xl font-extrabold text-neutral-900">Benefícios</h2>
          <ul class="mt-4 space-y-3 text-sm text-neutral-700">
            <li v-for="benefit in benefits" :key="benefit">{{ benefit }}</li>
          </ul>
        </section>

        <!-- PROVA SOCIAL -->
        <section class="rounded-2xl bg-white p-6 shadow-lg shadow-slate-900/5">
          <h2 class="text-2xl font-extrabold text-neutral-900">Prova social</h2>
          <div class="mt-6 grid gap-4 sm:grid-cols-2">
            <div
              v-for="item in testimonials"
              :key="item.text"
              class="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700"
            >
              <p>"{{ item.text }}"</p>
              <p class="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">{{ item.from }}</p>
            </div>
          </div>
        </section>

        <!-- FAQ -->
        <section class="rounded-2xl bg-white p-6 shadow-lg shadow-slate-900/5">
          <div class="flex items-center justify-between">
            <h2 class="text-2xl font-extrabold text-neutral-900">FAQ</h2>
          </div>
          <div class="mt-6 space-y-4">
            <div v-for="item in faqList" :key="item.question" class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <p class="text-sm font-semibold text-neutral-900">{{ item.question }}</p>
              <p class="mt-2 text-sm text-neutral-600">{{ item.answer }}</p>
            </div>
          </div>
        </section>

        <!-- CTA FINAL -->
        <section class="rounded-2xl bg-neutral-900 p-6 text-white shadow-lg shadow-slate-900/20">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-200">Pronto?</p>
              <h3 class="text-2xl font-extrabold">Chama no WhatsApp e resolve.</h3>
            </div>
            <div class="flex flex-wrap gap-3">
              <a
                :href="config.public.whatsappUrl"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center justify-center rounded-full bg-dudu-green px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Chamar no WhatsApp
              </a>
              <a href="#cobertura" class="inline-flex items-center justify-center rounded-full border border-white/40 px-5 py-3 text-sm font-semibold text-white">
                Ver cobertura
              </a>
            </div>
          </div>
        </section>
      </main>
      <AppFooter />
    </div>
  </div>
</template>
