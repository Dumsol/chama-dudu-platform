<script setup lang="ts">
import { PhChatTeardropText, PhMapPin, PhShoppingBag } from '@phosphor-icons/vue'
</script>

<template>
  <section id="como-funciona" class="bg-white">
    <div class="dudu-container pt-8 pb-12 lg:pt-[44px] lg:pb-[80px]">
      <h2 class="text-[26px] font-extrabold text-neutral-900 md:text-[28px]">
        Como o Dudu funciona na vida real
      </h2>
      <div class="mt-6 grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div class="grid gap-3 md:grid-cols-3">
            <div class="min-h-[140px] rounded-[20px] border-2 border-dudu-green/60 bg-white p-4 shadow-soft">
              <div class="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
                <PhChatTeardropText class="h-[18px] w-[18px] text-dudu-green" weight="fill" />
              </div>
              <p class="mt-3 text-[12px] font-semibold leading-[1.4] text-neutral-900">
                Cliente manda o bairro no WhatsApp.
              </p>
            </div>
            <div class="min-h-[140px] rounded-[20px] border-2 border-dudu-green/60 bg-white p-4 shadow-soft">
              <div class="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
                <PhMapPin class="h-[18px] w-[18px] text-dudu-green" weight="fill" />
              </div>
              <p class="mt-3 text-[12px] font-semibold leading-[1.4] text-neutral-900">
                Dudu lista quem está aberto por perto.
              </p>
            </div>
            <div class="min-h-[140px] rounded-[20px] border-2 border-dudu-green/60 bg-white p-4 shadow-soft">
              <div class="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
                <PhShoppingBag class="h-[18px] w-[18px] text-dudu-green" weight="fill" />
              </div>
              <p class="mt-3 text-[12px] font-semibold leading-[1.4] text-neutral-900">
                Escolhe, e o Dudu encaminha o pedido.
              </p>
            </div>
          </div>
          <div class="mt-7 grid gap-4 md:grid-cols-[0.9fr_1.1fr] md:items-center">
            <NuxtImg
              src="/images/how-illustration.webp"
              alt="Cliente pedindo no celular com o Dudu"
              class="w-full max-w-[260px]"
              loading="lazy"
              width="920"
              height="920"
            />
            <div class="space-y-4">
              <ul class="space-y-2 text-[13px] text-neutral-700">
                <li class="flex items-start gap-2">
                  <span class="mt-2 h-2 w-2 rounded-full bg-neutral-900" />
                  <span class="font-semibold text-neutral-900">Você fala com Dudu, ele resolve o resto.</span>
                </li>
                <li class="flex items-start gap-2">
                  <span class="mt-2 h-2 w-2 rounded-full bg-neutral-900" />
                  <span>Sem app, sem cadastro complicado.</span>
                </li>
              </ul>
              <a
                href="#para-clientes"
                class="inline-flex items-center rounded-full bg-dudu-green px-5 py-2 text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(47,179,74,0.35)]"
              >
                Quero pedir com Dudu
              </a>
            </div>
          </div>
        </div>
        <div class="rounded-[26px] border-2 border-dudu-green/60 bg-emerald-50/70 p-6 shadow-soft">
          <div class="grid gap-6 lg:grid-cols-[1fr_0.85fr] lg:items-start">
            <div>
              <h3 class="text-[20px] font-extrabold leading-tight text-neutral-900">
                Para depósitos de bairro que querem vender mais sem app complicado.
              </h3>
              <ul class="mt-4 space-y-2 text-[13px] text-neutral-700">
                <li>Recebe pedido pronto no WhatsApp.</li>
                <li>Abre, fecha e checa status em segundos.</li>
                <li>Sem mensalidade durante o beta.</li>
              </ul>
            </div>
            <div id="parceiro" class="flex w-full justify-end">
              <div class="w-full max-w-[210px]">
                <PartnerSignup />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
