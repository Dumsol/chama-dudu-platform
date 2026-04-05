<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  LineElement,
  PointElement,
  BarElement,
  CategoryScale,
  LinearScale,
} from 'chart.js'
import { Line, Bar } from 'vue-chartjs'

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  BarElement,
  Title,
  Tooltip,
  Legend
)

const isLoading = ref(true)

// Configuração base anti-grid e minimalista do Elastic Stack
const chartOptionsBase = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { mode: 'index', intersect: false }
  },
  scales: {
    x: { display: false },
    y: { 
      display: true, 
      border: { display: false },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
      ticks: { color: '#666', font: { size: 10 } }
    }
  },
  elements: {
    point: { radius: 0 }
  }
}

// Funções Helpers para mockar graficos exatos
function generateFakeLine(color, count = 20, min = 10, max = 50, tension=0.4) {
  return {
    labels: Array.from({length: count}, (_, i) => i),
    datasets: [{
      data: Array.from({length: count}, () => Math.floor(Math.random() * (max - min) + min)),
      borderColor: color,
      borderWidth: 2,
      tension: tension
    }]
  }
}

// Left Column Charts
const activeShardsData = generateFakeLine('#00ffff', 40, 0, 50000, 0)
const initShardsData = generateFakeLine('#00ffff', 40, 1000, 7000, 0.4)

// Middle Top Charts
const queryLatData = generateFakeLine('#00ffff', 30, 1000, 2000, 0.1)
const avgQueriesData = generateFakeLine('#32CD32', 30, 20, 25, 0.1)
const maxQueriesData = generateFakeLine('#32CD32', 30, 20, 25, 0.1)

// Middle Bottom (Indexing)
const idxLatData = generateFakeLine('#ff00ff', 30, 0, 1, 0.1)
const idxRefreshData = generateFakeLine('#ff00ff', 40, 50, 150, 0)
const idxTotalData = generateFakeLine('#ff00ff', 30, 0, 1, 0)

// JVM
const jvmHeapData = {
  labels: Array.from({length: 40}, (_, i) => i),
  datasets: [
    { data: Array.from({length:40}, () => Math.random()*2000), borderColor: '#ff7f00', borderWidth: 1 },
    { data: Array.from({length:40}, () => Math.random()*1500), borderColor: '#ff00ff', borderWidth: 1 },
    { data: Array.from({length:40}, () => Math.random()*1000), borderColor: '#00ffff', borderWidth: 1 }
  ]
}

const jvmAvgData = {
  labels: Array.from({length: 40}, (_, i) => i),
  datasets: [
    { data: Array.from({length:40}, () => 20000), borderColor: '#ff00ff', borderWidth: 1 },
    { data: Array.from({length:40}, () => 10000), borderColor: '#00ffff', borderWidth: 1 }
  ]
}
const jvmGcTimeData = generateFakeLine('#ff00ff', 40, 5, 20, 0.2)

// JVM GC Young (Bar)
const jvmGcYoungData = {
  labels: Array.from({length: 15}, (_, i) => i),
  datasets: [{
    data: Array.from({length: 15}, () => Math.random()*80),
    backgroundColor: '#ff00ff',
    barThickness: 4
  }]
}
const gcOptions = { ...chartOptionsBase, indexAxis: 'y', scales: { x: { display: false }, y: { display: true } } }

// Right Column (Errors/Threads)
const searchPoolMaxData = generateFakeLine('#00ffff', 40, 10, 30, 0)
const searchPoolRejData = generateFakeLine('#ff00ff', 40, 0, 1, 0)
const bulkPoolMaxData = generateFakeLine('#ff00ff', 40, 0, 1, 0)
const bulkPoolRejData = generateFakeLine('#ff00ff', 40, 0, 1, 0)
const pendingCountData = generateFakeLine('#ff00ff', 40, 0, 1, 0)
const pendingTimeData = generateFakeLine('#ff00ff', 40, 0, 1, 0)

onMounted(() => {
  setTimeout(() => { isLoading.value = false }, 500)
})
</script>

<template>
  <div class="m-0 p-0 top-0 left-0 w-full min-h-screen font-sans text-xs" style="background-color: #1a1a1a; color: #d0d0d0;">
    <div class="grid grid-cols-[300px_1fr_300px] gap-2 p-4 h-full">
      
      <!-- LEFT COLUMN -->
      <div class="flex flex-col gap-2">
        <!-- Logo Header -->
        <div class="flex items-center gap-3 p-3 bg-[#242424] border border-[#333]">
          <div class="grid grid-cols-2 gap-1 w-8 h-8">
            <div class="w-full h-full rounded-full bg-cyan-400"></div>
            <div class="w-full h-full rounded-full bg-yellow-400"></div>
            <div class="w-full h-full rounded-full bg-fuchsia-500"></div>
            <div class="w-full h-full rounded-full bg-blue-500"></div>
          </div>
          <div>
            <div class="text-white text-lg font-bold leading-none">elastic</div>
            <div class="text-xs text-gray-400 leading-none mt-1">Stack Monitoring <span class="text-white underline">Cluster View</span></div>
          </div>
        </div>

        <!-- Deployments -->
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div class="bg-[#1d7e5d] text-center p-3 text-white shadow-inner">
            <div class="text-[10px] uppercase mb-1 font-semibold text-white/80">Clusters Healthy</div>
            <div class="text-3xl font-bold">3</div>
            <div class="text-[10px]">Deployments</div>
          </div>
          <div class="bg-[#c91c12] text-center p-3 text-white shadow-inner">
            <div class="text-[10px] uppercase mb-1 font-semibold text-white/80">Clusters Unhealthy</div>
            <div class="text-3xl font-bold">1</div>
            <div class="text-[10px]">Deployments</div>
          </div>
        </div>

        <!-- Shards Cards -->
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div class="bg-[#242424] border border-[#333] flex flex-col items-center justify-center p-4">
            <div class="text-[9px] bg-[#333] px-2 py-0.5 rounded text-gray-300 self-start mb-2">Last 1 hour</div>
            <div class="text-3xl font-bold text-white">2,490</div>
            <div class="text-[10px] text-gray-400 mt-1">Started Shards</div>
          </div>
          <div class="bg-[#242424] border border-[#333] flex flex-col items-center justify-center p-4">
            <div class="text-[9px] bg-[#333] px-2 py-0.5 rounded text-gray-300 self-start mb-2">Last 1 hour</div>
            <div class="text-3xl font-bold text-white">0</div>
            <div class="text-[10px] text-gray-400 mt-1 text-center">Initializing<br/>Shards</div>
          </div>
          <div class="bg-[#242424] border border-[#333] flex flex-col items-center justify-center p-4">
            <div class="text-[9px] bg-[#333] px-2 py-0.5 rounded text-gray-300 self-start mb-2">Last 1 hour</div>
            <div class="text-3xl font-bold text-[#c91c12]">63</div>
            <div class="text-[10px] text-gray-400 mt-1 text-center">Unassigned<br/>Shards</div>
          </div>
          <div class="bg-[#242424] border border-[#333] flex flex-col items-center justify-center p-4">
            <div class="text-[9px] bg-[#333] px-2 py-0.5 rounded text-gray-300 self-start mb-2">Last 1 hour</div>
            <div class="text-3xl font-bold text-[#c91c12]">63</div>
            <div class="text-[10px] text-gray-400 mt-1 text-center">Unassigned<br/>Shards</div>
          </div>
        </div>

        <!-- Left Charts -->
        <div class="bg-[#242424] border border-[#333] p-2 mt-2">
          <div class="text-[10px] font-semibold text-white mb-2">Active Shards (Total & Primary)</div>
          <div class="h-24"><Line v-if="!isLoading" :data="activeShardsData" :options="chartOptionsBase" /></div>
        </div>
        <div class="bg-[#242424] border border-[#333] p-2 mt-2">
          <div class="text-[10px] font-semibold text-white mb-2">Shards Initializing, Relocating, Unassigned</div>
          <div class="h-24"><Line v-if="!isLoading" :data="initShardsData" :options="chartOptionsBase" /></div>
        </div>
      </div>

      <!-- MIDDLE COLUMN -->
      <div class="flex flex-col gap-2">
        <div class="text-sm font-semibold text-gray-300 px-2 py-1 bg-[#1a1a1a] border-b border-[#333]">Search and Indexing Performance</div>
        
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">Query Latency (ms)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="queryLatData" :options="chartOptionsBase" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">Indexing Latency (ms)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="idxLatData" :options="chartOptionsBase" /></div>
          </div>
          
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">Average Queries (TODO fetches?)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="avgQueriesData" :options="chartOptionsBase" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">Index Refresh Time /ms</div>
            <div class="h-16"><Line v-if="!isLoading" :data="idxRefreshData" :options="chartOptionsBase" /></div>
          </div>
          
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">Max Number of Queries</div>
            <div class="h-16"><Line v-if="!isLoading" :data="maxQueriesData" :options="chartOptionsBase" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">Indexing Total / s</div>
            <div class="h-16"><Line v-if="!isLoading" :data="idxTotalData" :options="chartOptionsBase" /></div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 mt-2">
          <div class="bg-[#242424] border border-[#333] p-2 flex">
            <div>
              <div class="text-[10px] text-white mb-2">Host with Most Queries</div>
              <div class="grid grid-cols-5 gap-1 w-20">
                <div v-for="i in 25" :key="i" class="w-2.5 h-2.5 bg-cyan-400 rounded-sm"></div>
                <div v-for="i in 10" :key="'f'+i" class="w-2.5 h-2.5 bg-fuchsia-400 rounded-sm"></div>
              </div>
            </div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white mb-2">Host with Most Indexing (TODO check)</div>
            <div class="grid grid-cols-8 gap-1 w-32">
               <div v-for="i in 40" :key="i" class="w-2.5 h-2.5 bg-cyan-400 rounded-sm"></div>
            </div>
          </div>
        </div>

        <div class="text-sm font-semibold text-gray-300 px-2 py-1 mt-2 bg-[#1a1a1a] border-b border-[#333]">Search and Indexing Performance</div>

        <div class="grid grid-cols-2 gap-2">
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">JVM Heap Used (Last Value) Top 10 Nodes</div>
            <div class="h-20"><Line v-if="!isLoading" :data="jvmHeapData" :options="chartOptionsBase" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">JVM Heap Avg used and max</div>
            <div class="h-20"><Line v-if="!isLoading" :data="jvmAvgData" :options="chartOptionsBase" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">JVM GC Young Count / s</div>
            <div class="h-20"><Bar v-if="!isLoading" :data="jvmGcYoungData" :options="gcOptions" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[10px] text-white">JVM Young & Old GC Average Time / sec</div>
            <div class="h-20"><Line v-if="!isLoading" :data="jvmGcTimeData" :options="chartOptionsBase" /></div>
          </div>
        </div>
      </div>

      <!-- RIGHT COLUMN -->
      <div class="flex flex-col gap-2">
        <div class="text-sm font-semibold text-gray-300 px-2 py-1 bg-[#1a1a1a] border-b border-[#333]">Resource Saturation and Errors</div>
        
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[9px] text-white">Search Thread Pool Max by node (top 10)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="searchPoolMaxData" :options="chartOptionsBase" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[9px] text-white">Bulk Thread Pool Max by node (top 10)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="bulkPoolMaxData" :options="chartOptionsBase" /></div>
          </div>

          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[9px] text-white">Cluster Pending Tasks by Source (count)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="pendingCountData" :options="chartOptionsBase" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[9px] text-white">Cluster Pending Task time (ms)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="pendingTimeData" :options="chartOptionsBase" /></div>
          </div>

          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[9px] text-white">Search Thread Pool Rejections by node (top 10)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="searchPoolRejData" :options="chartOptionsBase" /></div>
          </div>
          <div class="bg-[#242424] border border-[#333] p-2">
            <div class="text-[9px] text-white">Bulk Thread Pool Rejections by node (top 10)</div>
            <div class="h-16"><Line v-if="!isLoading" :data="bulkPoolRejData" :options="chartOptionsBase" /></div>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-2 mt-auto">
          <div class="bg-[#242424] border border-[#333] flex flex-col items-center justify-center p-8">
            <div class="text-6xl font-light text-cyan-500 mb-2">0</div>
            <div class="text-base text-gray-300">Unsuccessful GETs</div>
          </div>
          <div class="bg-[#242424] border border-[#333] flex flex-col items-center justify-center p-8">
            <div class="text-6xl font-medium text-[#c91c12] mb-2">93.55%</div>
            <div class="text-base text-gray-300">Disk Space Used</div>
          </div>
        </div>

      </div>

    </div>
  </div>
</template>
