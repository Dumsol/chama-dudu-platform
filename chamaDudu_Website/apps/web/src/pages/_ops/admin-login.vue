<script setup lang="ts">
import { extractApiErrorMessage } from '~/lib/api/client'
import { loginAdmin } from '~/lib/api/backoffice'

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

const password = ref('')
const error = ref('')
const loading = ref(false)

const submit = async () => {
  error.value = ''
  loading.value = true
  try {
    await loginAdmin(password.value)
    await navigateTo('/admin')
  } catch (err) {
    error.value = extractApiErrorMessage(err, 'Senha invalida.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-neutral-100">
    <div class="dudu-container flex min-h-screen items-center justify-center py-10">
      <div class="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-soft">
        <h1 class="text-2xl font-extrabold text-neutral-900">Admin</h1>
        <p class="mt-2 text-sm text-neutral-600">Acesso restrito ao time do Chama Dudu.</p>
        <form class="mt-6 space-y-4" @submit.prevent="submit">
          <input
            v-model="password"
            type="password"
            placeholder="Senha"
            class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-dudu-green focus:outline-none"
          >
          <button
            type="submit"
            class="w-full rounded-full bg-dudu-green px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(47,179,74,0.35)]"
            :disabled="loading"
          >
            {{ loading ? 'Entrando...' : 'Entrar' }}
          </button>
        </form>
        <p v-if="error" class="mt-4 text-xs font-semibold text-red-600">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
