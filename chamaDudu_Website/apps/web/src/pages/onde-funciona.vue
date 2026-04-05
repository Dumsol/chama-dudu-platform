<script setup lang="ts">
import { PhMapPin, PhInfo, PhArrowRight, PhMotorcycle } from '@phosphor-icons/vue'
import areasData from '../../data/operating-areas.json'

const areas = ref(areasData || [])
const selectedAreaId = ref<string | null>(null)

useSeoMeta({
  title: 'Onde Funciona? | Chama Dudu',
  description: 'Confira as áreas atendidas pelo Chama Dudu em Paulista-PE.'
})
</script>

<template>
  <div class="min-h-screen bg-neutral-50 font-sans text-neutral-900">
    <AppHeader />

    <main class="py-12 lg:py-20">
      <div class="dudu-container">
        <div class="mb-12 text-center lg:text-left">
          <h1 class="flex flex-wrap items-center justify-center gap-3 text-4xl font-black tracking-tight text-neutral-900 lg:justify-start">
            Onde o Dudu chega?
            <PhMotorcycle :size="40" weight="fill" class="text-dudu-green" />
          </h1>
          <p class="mt-4 text-lg text-neutral-600">Estamos expandindo rápido por toda Paulista-PE.</p>
        </div>

        <div class="grid gap-8 lg:grid-cols-[1fr_350px]">
          <!-- Mapa -->
          <div class="relative overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl min-h-[400px] lg:min-h-[600px] z-0">
             <ClientOnly>
               <MapDisplay 
                 :areas="areas || []" 
                 v-model:selectedId="selectedAreaId"
               />
               <template #fallback>
                 <div class="flex h-full w-full items-center justify-center bg-neutral-100 italic text-neutral-400">
                   Carregando mapa...
                 </div>
               </template>
             </ClientOnly>
          </div>

          <!-- Lista de Bairros -->
          <div class="space-y-4">
            <h2 class="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <PhMapPin :size="24" class="text-dudu-green" weight="fill" />
              Bairros Atendidos
            </h2>
            
            <div class="grid gap-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              <button 
                v-for="area in areas" 
                :key="area.id"
                @click="selectedAreaId = area.id"
                :class="[
                  'group flex items-center justify-between rounded-2xl border p-4 transition-all duration-200 text-left w-full',
                  selectedAreaId === area.id 
                    ? 'border-dudu-green bg-emerald-50 shadow-sm ring-1 ring-dudu-green' 
                    : 'border-neutral-200 bg-white hover:border-dudu-green/50 hover:bg-neutral-50'
                ]"
              >
                <div>
                  <p :class="['font-bold', selectedAreaId === area.id ? 'text-dudu-green' : 'text-neutral-900']">
                    {{ area.name }}
                  </p>
                  <p class="text-[10px] text-neutral-400 uppercase font-black mt-0.5">Paulista, PE</p>
                </div>
                <PhArrowRight 
                  :size="18" 
                  :class="[
                    'transition-transform duration-300',
                    selectedAreaId === area.id ? 'text-dudu-green translate-x-1' : 'text-neutral-300 group-hover:text-neutral-500'
                  ]" 
                />
              </button>
            </div>

            <!-- Info Card -->
            <div class="mt-6 rounded-2xl bg-neutral-900 p-6 text-white shadow-lg">
              <div class="flex items-center gap-3 mb-4">
                <div class="p-2 bg-white/10 rounded-lg">
                  <PhInfo :size="20" class="text-dudu-green" />
                </div>
                <h3 class="font-bold">Não achou seu bairro?</h3>
              </div>
              <p class="text-sm text-neutral-400 leading-relaxed">
                O Dudu está crescendo! Se o seu bairro ainda não está na lista, entre em contato e peça para chegarmos aí.
              </p>
              <a href="https://wa.me/5581985740561" target="_blank" class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-bold text-neutral-900 transition hover:bg-neutral-100">
                Sugerir Bairro
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
    <AppFooter />
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #248a3d33;
  border-radius: 10px;
}
</style>
