<script setup lang="ts">
const form = reactive({
  whatsapp: '',
  nome: '',
  bairro: ''
})

const state = reactive({
  loading: false,
  success: false,
  error: '',
  token: ''
})

const submit = async () => {
  state.error = ''
  state.success = false
  state.token = ''

  if (!form.whatsapp || !form.nome || !form.bairro) {
    state.error = 'Preencha todos os campos para continuar.'
    return
  }

  state.loading = true
  try {
    const data = await $fetch<{ depositToken: string }>('/api/pre-cadastro', {
      method: 'POST',
      body: {
        whatsapp: form.whatsapp,
        nome: form.nome,
        bairro: form.bairro
      }
    })
    state.success = true
    state.token = data.depositToken
    form.whatsapp = ''
    form.nome = ''
    form.bairro = ''
  } catch (error) {
    const err = error as { data?: { message?: string } }
    state.error = err?.data?.message || 'Não foi possível enviar agora.'
  } finally {
    state.loading = false
  }
}
</script>

<template>
  <div class="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_10px_24px_rgba(0,0,0,0.12)]">
    <h3 class="text-[15px] font-extrabold text-neutral-900">Pré-cadastro</h3>
    <form class="mt-3 space-y-2" @submit.prevent="submit">
      <input
        v-model="form.whatsapp"
        type="text"
        placeholder="WhatsApp"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >
      <input
        v-model="form.nome"
        type="text"
        placeholder="Nome do depósito"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >
      <input
        v-model="form.bairro"
        type="text"
        placeholder="Bairro e cidade"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >
      <div class="mt-2 flex items-center gap-2">
        <button
          type="submit"
          class="flex-1 rounded-full bg-dudu-green px-4 py-2 text-[12px] font-semibold text-white shadow-[0_8px_18px_rgba(47,179,74,0.35)] transition hover:brightness-110 disabled:opacity-60"
          :disabled="state.loading"
        >
          {{ state.loading ? 'Enviando...' : 'Cadastrar meu depósito' }}
        </button>
        <div class="w-[78px] rounded-full border border-neutral-200 px-2 py-1 text-[9px] leading-[1.2] text-neutral-600">
          Chama Dudu salva na madrugada.
        </div>
      </div>
    </form>
    <p v-if="state.error" class="mt-3 text-[11px] font-semibold text-red-600">
      {{ state.error }}
    </p>
    <div v-if="state.success" class="mt-3 rounded-lg border border-dudu-green/40 bg-emerald-50 p-3 text-[11px] text-neutral-900">
      Token do depósito: <strong>{{ state.token }}</strong>
      <p class="mt-1 text-[10px] text-neutral-600">
        Guarde esse token para entrar no painel do depósito.
      </p>
    </div>
  </div>
</template>
