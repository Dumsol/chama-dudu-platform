<script setup lang="ts">
useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

await navigateTo('/_ops/deposito-login', { replace: true })
</script>

<template>
  <div class="sr-only">redirecionando</div>
</template>
