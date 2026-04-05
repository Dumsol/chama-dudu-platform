<script setup lang="ts">
import {
  PhUser,
  PhStorefront,
  PhWhatsappLogo,
  PhCheckCircle,
  PhArrowRight,
  PhLightning,
  PhMapPin,
  PhQrCode,
  PhDeviceMobile,
  PhRobot,
  PhChartLineUp,
  PhUsersThree
} from '@phosphor-icons/vue'

const activeTab = ref<'cliente' | 'parceiro'>('cliente')

const clienteFeatures = [
  {
    icon: PhWhatsappLogo,
    title: 'Sem baixar nada',
    desc: 'O Dudu vive dentro do seu WhatsApp. Não ocupa espaço no celular.'
  },
  {
    icon: PhLightning,
    title: 'Busca Instantânea',
    desc: 'Mandou o bairro, recebeu a lista. Sem menus infinitos ou demora.'
  },
  {
    icon: PhMapPin,
    title: 'Foco Local',
    desc: 'Encontre o depósito da esquina que o Zé Delivery não mostra.'
  },
  {
    icon: PhCheckCircle,
    title: 'Preço Direto',
    desc: 'Sem taxas escondidas. Você vê o preço real do depósito.'
  }
]

const parceiroFeatures = [
  {
    icon: PhRobot,
    title: 'Atendimento Automático',
    desc: 'O Dudu filtra os pedidos e tira dúvidas básicas sozinho.'
  },
  {
    icon: PhChartLineUp,
    title: 'Visibilidade no Bairro',
    desc: 'Seja encontrado por quem está buscando agora na sua região.'
  },
  {
    icon: PhUsersThree,
    title: 'Base de Clientes',
    desc: 'O sistema salva os contatos para você fazer promoções depois.'
  },
  {
    icon: PhDeviceMobile,
    title: 'Gestão Simplificada',
    desc: 'Abra ou feche sua loja com um simples comando no Zap.'
  }
]

useSeoMeta({
  title: 'Entenda o App | Chama Dudu',
  description: 'Saiba como o Chama Dudu revoluciona o delivery de bebidas para clientes e depósitos em Paulista-PE.'
})
</script>

<template>
  <div class="min-h-screen bg-neutral-50 font-sans">
    <AppHeader />

    <main class="py-12 lg:py-20">
      <div class="dudu-container">
        <!-- Header da Página -->
        <div class="text-center">
          <h1 class="text-4xl font-black tracking-tight text-neutral-900 md:text-5xl">
            O App que não ocupa espaço
          </h1>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-neutral-600">
            O Chama Dudu é uma camada de inteligência sobre o WhatsApp que conecta quem quer beber com quem quer vender.
          </p>
        </div>

        <!-- Toggle Cliente/Parceiro -->
        <div class="mt-12 flex justify-center relative z-50">
          <div class="inline-flex rounded-2xl bg-white p-1.5 shadow-md border border-neutral-200 pointer-events-auto">
            <button
              @click="() => { console.log('Tab: cliente'); activeTab = 'cliente' }"
              :class="activeTab === 'cliente' ? 'bg-dudu-green text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-800'"
              class="relative z-30 flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition-all duration-200 cursor-pointer user-select-none touch-manipulation"
            >
              <PhUser :size="20" :weight="activeTab === 'cliente' ? 'fill' : 'bold'" />
              Sou Cliente
            </button>
            <button
              @click="() => { console.log('Tab: parceiro'); activeTab = 'parceiro' }"
              :class="activeTab === 'parceiro' ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-800'"
              class="relative z-30 flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition-all duration-200 cursor-pointer user-select-none touch-manipulation"
            >
              <PhStorefront :size="20" :weight="activeTab === 'parceiro' ? 'fill' : 'bold'" />
              Sou Depósito
            </button>
          </div>
        </div>

        <!-- Conteúdo Dinâmico -->
        <div class="mt-16">
          <Transition
            mode="out-in"
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 translate-y-4"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 -translate-y-4"
          >
            <!-- Visão Cliente -->
            <div v-if="activeTab === 'cliente'" key="cliente" class="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <span class="text-[11px] font-bold uppercase tracking-[0.2em] text-dudu-green">Para quem quer facilidade</span>
                <h2 class="mt-4 text-3xl font-black text-neutral-900">Como funciona para você</h2>
                <div class="mt-8 grid gap-6 sm:grid-cols-2">
                  <div v-for="f in clienteFeatures" :key="f.title" class="rounded-2xl bg-white p-6 shadow-sm border border-neutral-100">
                    <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-dudu-green">
                      <component :is="f.icon" :size="22" weight="fill" />
                    </div>
                    <h3 class="mt-4 font-bold text-neutral-900">{{ f.title }}</h3>
                    <p class="mt-2 text-sm text-neutral-500">{{ f.desc }}</p>
                  </div>
                </div>
                <div class="mt-10">
                  <a href="https://wa.me/5581985740561" target="_blank" class="inline-flex items-center gap-2 rounded-full bg-dudu-green px-8 py-4 text-lg font-bold text-white shadow-lg transition hover:scale-105 active:scale-95">
                    WhatsApp (81) 98574-0561
                    <PhWhatsappLogo :size="24" weight="fill" />
                  </a>
                </div>
              </div>
              <div class="relative flex justify-center">
                <div class="absolute inset-0 bg-dudu-green/10 blur-[100px] rounded-full"></div>
                <div class="relative w-full max-w-[400px] overflow-hidden rounded-[40px] border-[8px] border-neutral-900 shadow-2xl bg-white aspect-[9/19]">
                  <!-- Simulação do WhatsApp -->
                  <div class="bg-[#075E54] p-4 text-white flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-white/20"></div>
                    <div>
                      <p class="font-bold text-sm">Dudu (Chama Dudu)</p>
                      <p class="text-[10px] opacity-70">online</p>
                    </div>
                  </div>
                  <div class="p-4 space-y-4 bg-[#E5DDD5] h-full overflow-y-auto">
                    <div class="bg-white p-3 rounded-lg rounded-tl-none shadow-sm max-w-[80%] text-xs">
                      Olá! Qual o seu bairro em Paulista hoje? 🥤
                    </div>
                    <div class="bg-[#DCF8C6] p-3 rounded-lg rounded-tr-none shadow-sm ml-auto max-w-[80%] text-xs">
                      Janga
                    </div>
                    <div class="bg-white p-3 rounded-lg rounded-tl-none shadow-sm max-w-[80%] text-xs">
                       Encontrei 3 depósitos abertos no Janga agora! Qual você prefere?<br><br>
                       1. Depósito do Gago<br>
                       2. Bebidas 24h<br>
                       3. Conveniência Janga
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Visão Parceiro -->
            <div v-else key="parceiro" class="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div class="order-2 lg:order-1 relative flex justify-center">
                <div class="absolute inset-0 bg-neutral-900/10 blur-[100px] rounded-full"></div>
                <!-- Mockup de Dashboard -->
                <div class="relative w-full max-w-[500px] rounded-2xl border border-neutral-200 bg-white shadow-2xl overflow-hidden aspect-video lg:aspect-square p-6">
                   <div class="flex items-center justify-between border-b pb-4 mb-6">
                      <h4 class="font-black text-neutral-900">Painel do Depósito</h4>
                      <div class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">ABERTO</div>
                   </div>
                   <div class="grid grid-cols-2 gap-4">
                      <div class="p-4 bg-neutral-50 rounded-xl">
                        <p class="text-[10px] text-neutral-400 font-bold uppercase">Pedidos Hoje</p>
                        <p class="text-2xl font-black text-neutral-900">24</p>
                      </div>
                      <div class="p-4 bg-neutral-50 rounded-xl">
                        <p class="text-[10px] text-neutral-400 font-bold uppercase">Novos Clientes</p>
                        <p class="text-2xl font-black text-neutral-900">+8</p>
                      </div>
                   </div>
                   <div class="mt-6 space-y-3">
                      <div class="flex items-center justify-between p-3 border rounded-xl bg-white shadow-sm">
                        <div class="flex items-center gap-3">
                           <div class="w-8 h-8 rounded-full bg-neutral-200"></div>
                           <p class="text-xs font-bold">João (Janga) - Heinken...</p>
                        </div>
                        <PhArrowRight :size="16" class="text-neutral-400" />
                      </div>
                      <div class="flex items-center justify-between p-3 border rounded-xl bg-white shadow-sm">
                        <div class="flex items-center gap-3">
                           <div class="w-8 h-8 rounded-full bg-neutral-200"></div>
                           <p class="text-xs font-bold">Maria (Pau Amarelo)...</p>
                        </div>
                        <PhArrowRight :size="16" class="text-neutral-400" />
                      </div>
                   </div>
                </div>
              </div>
              <div class="order-1 lg:order-2">
                <span class="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">Para donos de depósito</span>
                <h2 class="mt-4 text-3xl font-black text-neutral-900">Tecnologia para vender mais</h2>
                <div class="mt-8 grid gap-6 sm:grid-cols-2">
                  <div v-for="f in parceiroFeatures" :key="f.title" class="rounded-2xl bg-white p-6 shadow-sm border border-neutral-100">
                    <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-900">
                      <component :is="f.icon" :size="22" weight="fill" />
                    </div>
                    <h3 class="mt-4 font-bold text-neutral-900">{{ f.title }}</h3>
                    <p class="mt-2 text-sm text-neutral-500">{{ f.desc }}</p>
                  </div>
                </div>
                <div class="mt-10">
                  <NuxtLink to="/#parceiro" class="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-8 py-4 text-lg font-bold text-white shadow-lg transition hover:scale-105">
                    Quero ser um parceiro
                    <PhStorefront :size="24" weight="fill" />
                  </NuxtLink>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </main>

    <AppFooter />
  </div>
</template>

<style scoped>
/* Transições suaves para o toggle */
.v-enter-active,
.v-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.v-enter-from,
.v-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
