<script setup lang="ts">
useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

await navigateTo('/_ops/admin-login', { replace: true })
</script>

<template>
  <div class="sr-only">redirecionando</div>
</template>
