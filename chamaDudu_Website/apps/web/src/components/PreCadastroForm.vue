<script setup lang="ts">
import { computed } from 'vue'
import { z } from 'zod'
import { postPreCadastroDeposito } from '~/lib/http'
import { normalizeBrazilWhatsApp, parseSupportedDdds, resolveRegionStatus } from '~/lib/phone/brWhatsApp'

const config = useRuntimeConfig()
const supportedDdds = parseSupportedDdds(String(config.public.supportedDdds ?? '81'))

const schema = z.object({
  nomeDeposito: z.string().trim().min(2, 'Informe o nome do deposito.'),
  responsavel: z.string().trim().min(2, 'Informe o responsavel.'),
  whatsapp: z
    .string()
    .trim()
    .min(8, 'Informe um WhatsApp valido.')
    .transform((value) => value.replace(/[^\d]/g, '')),
  bairro: z.string().trim().min(2, 'Informe o bairro.'),
  cidade: z.string().trim().min(2, 'Informe a cidade.'),
  cnpj: z.string().trim().max(20, 'CNPJ muito longo.').optional(),
  entregaPropria: z.boolean({ required_error: 'Informe se possui entrega própria.' })
})

const form = reactive({
  nomeDeposito: '',
  responsavel: '',
  whatsapp: '',
  bairro: '',
  cidade: '',
  cnpj: '',
  entregaPropria: null as boolean | null
})

const state = reactive({
  loading: false,
  success: false,
  error: '',
  createdId: ''
})

const whatsappStatus = computed(() => {
  const parsed = normalizeBrazilWhatsApp(form.whatsapp)
  if (!form.whatsapp.trim()) {
    return { valid: false, supported: false, message: '', ddd: null as string | null }
  }
  if (!parsed.valid || !parsed.ddd) {
    return { valid: false, supported: false, message: 'Informe um WhatsApp valido com DDD.', ddd: null as string | null }
  }
  const regionStatus = resolveRegionStatus(parsed.ddd, supportedDdds)
  if (regionStatus === 'unsupported') {
    return {
      valid: true,
      supported: false,
      message:
        'Ainda nao estamos disponiveis na sua regiao. No momento, o Chama o Dudu atende apenas alguns DDDs selecionados.',
      ddd: parsed.ddd
    }
  }
  return {
    valid: true,
    supported: true,
    message: `DDD ${parsed.ddd} atendido. Seguimos com seu pre-cadastro.`,
    ddd: parsed.ddd
  }
})

const canSubmit = computed(() => {
  return form.nomeDeposito.trim().length >= 2 &&
    form.responsavel.trim().length >= 2 &&
    whatsappStatus.value.valid &&
    whatsappStatus.value.supported &&
    form.bairro.trim().length >= 2 &&
    form.cidade.trim().length >= 2 &&
    form.entregaPropria !== null &&
    !state.loading
})

async function submit(): Promise<void> {
  state.error = ''
  state.success = false
  state.createdId = ''

  const parsed = schema.safeParse(form)
  if (!parsed.success) {
    state.error = parsed.error.issues[0]?.message || 'Dados invalidos.'
    return
  }
  if (!whatsappStatus.value.valid) {
    state.error = 'Informe um WhatsApp valido com DDD.'
    return
  }
  if (!whatsappStatus.value.supported) {
    state.error =
      'Ainda nao estamos disponiveis na sua regiao. Voce pode deixar seu interesse e avisaremos quando abrir.'
    return
  }

  state.loading = true
  try {
    const submitPayload = {
      ...parsed.data,
      isPreCadastro: true,
      entregaPropria: form.entregaPropria === true
    }
    const result = await postPreCadastroDeposito(submitPayload as any)
    if (result.regionStatus === 'unsupported') {
      state.error = result.message || 'Regiao ainda nao suportada.'
      return
    }
    if (!result.id) {
      state.error = result.message || 'Nao foi possivel concluir o pre-cadastro.'
      return
    }
    state.success = true
    state.createdId = result.id
    Object.assign(form, {
      nomeDeposito: '',
      responsavel: '',
      whatsapp: '',
      bairro: '',
      cidade: '',
      cnpj: '',
      entregaPropria: null
    })
  } catch (error) {
    const err = error as { data?: { message?: string }; statusMessage?: string }
    state.error =
      err?.data?.message ||
      err?.statusMessage ||
      'Nao conseguimos concluir o pre-cadastro agora. Tenta novamente em instantes.'
  } finally {
    state.loading = false
  }
}
</script>

<template>
  <div class="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_10px_24px_rgba(0,0,0,0.12)]">
    <h3 class="text-[15px] font-extrabold text-neutral-900">Pre-cadastro do deposito</h3>
    <form class="mt-3 space-y-2" novalidate @submit.prevent="submit">
      <label class="block text-[11px] font-semibold text-neutral-700" for="nomeDeposito">Nome do deposito</label>
      <input
        id="nomeDeposito"
        v-model="form.nomeDeposito"
        type="text"
        autocomplete="organization"
        placeholder="Nome do deposito"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >
      <p
        v-if="whatsappStatus.message"
        :class="[
          'text-[11px] font-medium',
          whatsappStatus.supported ? 'text-emerald-700' : 'text-amber-700'
        ]"
      >
        {{ whatsappStatus.message }}
      </p>

      <label class="block text-[11px] font-semibold text-neutral-700" for="responsavel">Responsavel</label>
      <input
        id="responsavel"
        v-model="form.responsavel"
        type="text"
        autocomplete="name"
        placeholder="Responsavel"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >

      <label class="block text-[11px] font-semibold text-neutral-700" for="whatsapp">WhatsApp</label>
      <input
        id="whatsapp"
        v-model="form.whatsapp"
        type="tel"
        autocomplete="tel"
        placeholder="(81) 99999-9999"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >

      <label class="block text-[11px] font-semibold text-neutral-700" for="bairro">Bairro</label>
      <input
        id="bairro"
        v-model="form.bairro"
        type="text"
        autocomplete="address-level2"
        placeholder="Bairro"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >

      <label class="block text-[11px] font-semibold text-neutral-700" for="cidade">Cidade</label>
      <input
        id="cidade"
        v-model="form.cidade"
        type="text"
        autocomplete="address-level1"
        placeholder="Cidade"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >

      <label class="block text-[11px] font-semibold text-neutral-700" for="cnpj">CNPJ (opcional)</label>
      <input
        id="cnpj"
        v-model="form.cnpj"
        type="text"
        inputmode="numeric"
        placeholder="00.000.000/0000-00"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[12px] focus:border-dudu-green focus:outline-none"
      >

      <div class="space-y-1.5 py-1">
        <p class="text-[11px] font-semibold text-neutral-700">Possui entrega própria?</p>
        <div class="flex gap-4">
          <label class="flex items-center gap-2 text-[12px] text-neutral-600">
            <input v-model="form.entregaPropria" type="radio" :value="true" class="accent-dudu-green">
            Sim
          </label>
          <label class="flex items-center gap-2 text-[12px] text-neutral-600">
            <input v-model="form.entregaPropria" type="radio" :value="false" class="accent-dudu-green">
            Não
          </label>
        </div>
      </div>

      <button
        type="submit"
        class="mt-2 w-full rounded-full bg-dudu-green px-4 py-2 text-[12px] font-semibold text-white shadow-[0_8px_18px_rgba(47,179,74,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!canSubmit"
      >
        {{ state.loading ? 'Enviando...' : 'Cadastrar meu deposito' }}
      </button>
      <p class="text-[11px] text-neutral-600">
        Apos o envio, continuamos a confirmacao pelo WhatsApp. A localizacao compartilhada no fluxo sera a localizacao oficial do estabelecimento.
      </p>
    </form>

    <p v-if="state.error" aria-live="polite" class="mt-3 text-[11px] font-semibold text-red-600">
      {{ state.error }}
    </p>
    <div
      v-if="state.success"
      aria-live="polite"
      class="mt-3 rounded-lg border border-dudu-green/40 bg-emerald-50 p-3 text-[11px] text-neutral-900"
    >
      Pre-cadastro enviado com sucesso.
      <p class="mt-1 text-[10px] text-neutral-600">
        ID de referencia: <strong>{{ state.createdId }}</strong>
      </p>
    </div>
  </div>
</template>
