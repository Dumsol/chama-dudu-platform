<script setup lang="ts">
import { onMounted } from 'vue'
import { initAnalytics } from '~/lib/analytics'

onMounted(() => {
  void initAnalytics()
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
