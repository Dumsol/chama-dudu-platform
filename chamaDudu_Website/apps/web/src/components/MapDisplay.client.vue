<script setup lang="ts">
import { onMounted, shallowRef, ref, watch, onUnmounted, nextTick } from 'vue'

const props = defineProps<{
  areas: any[]
  selectedId: string | null
}>()

const emit = defineEmits(['update:selectedId'])

const mapContainer = ref<HTMLElement | null>(null)
const map = shallowRef<any>(null)
const markers = new Map<string, any>()

// Why is this ref always pending. my gosh 12 hours and still does not work
const status = ref({

const loadError = ref<string | null>(null)
const isLoading = ref(true)

const initMap = (mlib: any) => {
  if (!mapContainer.value) {
    status.value.container = 'ERRO: Não encontrado'
    return
  }
  status.value.container = 'OK'
  status.value.areas = String(props.areas?.length || 0)

  try {
    const centerLatLng: [number, number] = props.areas && props.areas.length > 0 
      ? [props.areas[0].lng, props.areas[0].lat] 
      : [-34.8814, -7.9403]

    map.value = new mlib.Map({
      container: mapContainer.value,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: centerLatLng,
      zoom: 12,
      attributionControl: false,
      trackResize: true
    })

    status.value.engine = 'Inicializando...'

    map.value.on('load', () => {
      status.value.engine = 'OK'
      isLoading.value = false
      map.value.resize()
    })

    map.value.on('error', (e: any) => {
      console.error('MapLibre Error:', e)
      status.value.engine = 'ERRO'
      loadError.value = 'H-03: Falha no carregamento do estilo.'
    })

    // Controls
    map.value.addControl(new mlib.NavigationControl(), 'top-right')
    map.value.addControl(new mlib.AttributionControl({ compact: true }), 'bottom-right')

    // Markers
    props.areas.forEach((area) => {
      const el = document.createElement('div')
      el.className = 'dudu-marker'
      el.innerHTML = `
        <div class="marker-container">
          <div class="marker-shadow"></div>
          <div class="marker-icon">
            <svg width="24" height="24" viewBox="0 0 256 256"><path fill="currentColor" d="M176 104a48 48 0 1 1-48-48a48 48 0 0 1 48 48m32-15.35c0 38.6-48 94.62-72 120.35c-4.46 4.78-11.54 4.78-16 0c-24-25.73-72-81.75-72-120.35a80 80 0 1 1 160 0m-16 0a64 64 0 1 0-128 0c0 31.11 41.33 79.5 64 104.53c22.67-25.03 64-73.42 64-104.53"/></svg>
          </div>
        </div>
      `

      const marker = new mlib.Marker({ element: el })
        .setLngLat([area.lng, area.lat])
        .setPopup(new mlib.Popup({ offset: 35 }).setHTML(`<b style="font-family: sans-serif;">${area.name}</b>`))
        .addTo(map.value!)

      el.addEventListener('click', () => emit('update:selectedId', area.id))
      markers.set(area.id, marker)
    })

    if ('ResizeObserver' in window) {
      new ResizeObserver(() => map.value?.resize()).observe(mapContainer.value)
    }

  } catch (err: any) {
    status.value.engine = 'CRASH'
    loadError.value = `F-02: ${err.message}`
  }
}

onMounted(() => {
  // It's 3 AM and I'm still checking if this library exists. Please just load.
  console.log('MapDisplay: Client mounted')
  let retries = 0
  const checkLib = setInterval(() => {
    const mlib = (window as any).maplibregl
    if (mlib) {
      clearInterval(checkLib)
      status.value.lib = 'OK (' + mlib.version + ')'
      initMap(mlib)
    } else if (retries > 60) { // 6 seconds
      clearInterval(checkLib)
      status.value.lib = 'TIMEOUT'
      loadError.value = 'H-01: Biblioteca não encontrada no window'
      isLoading.value = false
    }
    retries++
    status.value.lib = 'Verificando... (' + retries + ')'
  }, 100)
})

onUnmounted(() => map.value?.remove())

watch(() => props.selectedId, (newId) => {
  if (newId && map.value) {
    const area = props.areas.find(a => a.id === newId)
    if (area) {
      map.value.flyTo({ center: [area.lng, area.lat], zoom: 14 })
      markers.get(newId)?.togglePopup()
    }
  }
})
</script>

<template>
  <div class="relative h-full w-full bg-[#f1f3f5] overflow-hidden">
    <!-- I spent 1000 years on this map and it still flickers sometimes. Why. -->
    <div ref="mapContainer" class="absolute inset-0 z-0 h-full w-full" />
    
    <!-- If you see this spinner, something is probably broken again. I give up. -->
    <div v-if="isLoading && !loadError" class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 backdrop-blur-md">
      <div class="h-10 w-10 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent mb-6"></div>
      
      <!-- This status table is for my own sanity because this library is a nightmare -->
      <div class="text-[10px] uppercase tracking-widest text-emerald-900/40 font-mono text-center space-y-1">
        <div>LIB: {{ status.lib }}</div>
        <div>DOM: {{ status.container }}</div>
        <div>AREAS: {{ status.areas }}</div>
        <div>ENGINE: {{ status.engine }}</div>
      </div>
    </div>

    <!-- Error State -->
    <div v-if="loadError" class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white p-12 text-center">
      <div class="mb-6 rounded-2xl bg-red-50 p-5 text-red-500 shadow-sm border border-red-100">
        <svg width="40" height="40" viewBox="0 0 256 256"><path fill="currentColor" d="M236.8 188.09L149.35 36.22a24.76 24.76 0 0 0-42.7 0L19.2 188.09a23.51 23.51 0 0 0 0 23.72A24.35 24.35 0 0 0 40.55 224h174.9a24.35 24.35 0 0 0 21.35-12.19a23.51 23.51 0 0 0 0-23.72M120 104a8 8 0 0 1 16 0v40a8 8 0 0 1-16 0Zm8 88a12 12 0 1 1 12-12a12 12 0 0 1-12 12"/></svg>
      </div>
      <h3 class="text-lg font-black text-neutral-900">Mapa não inicializado</h3>
      <p class="mt-2 text-sm text-neutral-500 max-w-xs mx-auto leading-relaxed">{{ loadError }}</p>
      
      <div class="mt-4 rounded bg-neutral-100 px-3 py-1 font-mono text-[10px] text-neutral-400">
        {{ status }}
      </div>

      <button @click="() => window.location.reload()" class="mt-8 rounded-2xl bg-neutral-900 px-8 py-3 text-sm font-black text-white hover:bg-neutral-800 transition active:scale-95 shadow-xl shadow-neutral-200">
        RECARRREGAR PÁGINA
      </button>
    </div>
  </div>
</template>

<style>
/* Optimized Marker System */
.marker-container { position: relative; width: 40px; height: 40px; cursor: pointer; }
.marker-shadow { position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%); width: 12px; height: 4px; background: rgba(0,0,0,0.2); border-radius: 50%; filter: blur(1px); }
.marker-icon { background: #16a34a; color: white; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 12px; border: 2px solid white; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.marker-container:hover .marker-icon { transform: translateY(-4px) scale(1.1); }
.maplibregl-canvas { outline: none; }
.maplibregl-popup-content { border-radius: 16px !important; padding: 12px 16px !important; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2) !important; font-family: 'Outfit', sans-serif; border: 1px solid #f1f3f5; }
.maplibregl-popup-close-button { right: 8px; top: 8px; font-size: 14px; }
</style>
