<script setup lang="ts">
const config = useRuntimeConfig()

const navItems = [
  { label: 'Cliente', to: '/cliente' },
  { label: 'Cobertura', to: '/onde-funciona' }
]
</script>

<template>
  <header class="bg-white/95 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
    <div class="dudu-container flex items-center justify-between py-2.5">
      <NuxtLink to="/" class="flex items-center gap-3">
        <NuxtImg src="/images/logo.png" alt="Chama Dudu" class="h-[56px] w-auto" />
      </NuxtLink>
      <nav class="hidden items-center gap-6 text-[13px] font-semibold text-neutral-700 lg:flex">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="transition hover:text-neutral-900"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>
      <a
        :href="config.public.whatsappUrl"
        target="_blank"
        rel="noopener"
        class="rounded-full bg-dudu-green px-7 py-2 text-[13px] font-semibold text-white shadow-[0_8px_16px_rgba(47,179,74,0.35)] transition hover:brightness-110"
      >
        Chamar no WhatsApp
      </a>
    </div>
  </header>
</template>
