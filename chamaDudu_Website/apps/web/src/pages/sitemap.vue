<script setup lang="ts">
import { PhArrowRight } from '@phosphor-icons/vue'

useHead({
  title: 'Mapa do Site - Chama o Dudu',
  meta: [
    { name: 'description', content: 'Navegue por todas as páginas e seções do site oficial do Chama o Dudu.' }
  ]
})

const sections = [
  {
    title: 'Institucional',
    links: [
      { label: 'Página Inicial', to: '/' },
      { label: 'Como Funciona', to: '/#como-funciona' },
      { label: 'Benefícios', to: '/#beneficios' },
      { label: 'Depósitos Parceiros', to: '/#parceiro' },
      { label: 'FAQ (Perguntas Frequentes)', to: '/#faq' }
    ]
  },
  {
    title: 'Recursos',
    links: [
      { label: 'O App Chama Dudu', to: '/app' },
      { label: 'Onde Funciona', to: '/onde-funciona' },
      { label: 'Área do Depósito (Login)', to: '/admin/login' }
    ]
  },
  {
    title: 'Legal e Suporte',
    links: [
      { label: 'Termos de Uso', to: '/termos' },
      { label: 'Política de Privacidade', to: '/privacidade' },
      { label: 'Sitemap XML', to: '/sitemap.xml', external: true }
    ]
  }
]
</script>

<template>
  <div class="min-h-screen bg-slate-50 pt-[120px] pb-24">
    <AppHeader />
    
    <div class="dudu-container">
      <div class="max-w-4xl mx-auto">
        <header class="mb-12">
          <h1 class="text-4xl font-black tracking-tight text-slate-900 mb-4">
            Mapa do Site
          </h1>
          <p class="text-slate-600 text-lg">
            Encontre rapidamente o que você procura no ecossistema Chama Dudu.
          </p>
        </header>

        <div class="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          <div 
            v-for="section in sections" 
            :key="section.title"
            class="bg-white p-8 rounded-2xl shadow-sm border border-slate-100"
          >
            <h2 class="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
              <span class="w-2 h-2 bg-dudu-green rounded-full"></span>
              {{ section.title }}
            </h2>
            
            <ul class="space-y-4">
              <li v-for="link in section.links" :key="link.to">
                <NuxtLink 
                  v-if="!link.external"
                  :to="link.to"
                  class="group flex items-center justify-between text-slate-600 hover:text-dudu-green transition-colors font-medium"
                >
                  {{ link.label }}
                  <PhArrowRight :size="16" weight="bold" class="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                </NuxtLink>
                <a
                  v-else
                  :href="link.to"
                  target="_blank"
                  class="group flex items-center justify-between text-slate-600 hover:text-dudu-green transition-colors font-medium"
                >
                  {{ link.label }}
                  <PhArrowRight :size="16" weight="bold" class="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div class="mt-16 p-8 rounded-3xl bg-dudu-green/5 border border-dudu-green/10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 class="text-xl font-bold text-slate-900 mb-2">Ainda com dúvidas?</h3>
            <p class="text-slate-600">Chama o suporte direto no WhatsApp para uma resposta na hora.</p>
          </div>
          <a
            href="https://wa.me/5581985740561"
            target="_blank"
            class="whitespace-nowrap px-8 py-4 bg-dudu-green text-white font-bold rounded-full shadow-lg shadow-dudu-green/20 hover:brightness-110 transition-all"
          >
            Suporte WhatsApp
          </a>
        </div>
      </div>
    </div>

    <AppFooter />
  </div>
</template>
