<script setup lang="ts">
const config = useRuntimeConfig()
</script>

<template>
  <section class="hero-glow relative overflow-hidden text-white">
    <div class="hero-art pointer-events-none absolute bottom-0 right-[70px] hidden lg:block" />
    <div class="dudu-container relative z-10 grid items-start gap-6 py-28 lg:min-h-[880px] lg:grid-cols-[1fr_0.95fr] lg:pt-[180px] lg:pb-[140px]">
      <div class="max-w-[560px] lg:pt-8">
        <h1 class="text-[44px] font-extrabold leading-[1.22]">
          Chama Dudu e descobre<br>
          quem tá aberto no teu<br>
          bairro agora.
        </h1>
        <p class="mt-4 text-[16px] leading-[1.6] text-white/80">
          Um bot no WhatsApp que conecta você aos depósitos de<br>
          bebidas da tua área — sem app, sem enrolação.
        </p>
        <div class="mt-7 flex flex-col gap-3">
          <a
            :href="config.public.whatsappUrl"
            target="_blank"
            rel="noopener"
            class="inline-flex w-[255px] items-center justify-center rounded-full bg-dudu-green px-7 py-[14px] text-[15px] font-semibold text-white shadow-[0_10px_24px_rgba(47,179,74,0.4)] transition hover:brightness-110"
          >
            Chamar no WhatsApp
          </a>
          <a href="#parceiro" class="text-[13px] font-semibold underline underline-offset-4">
            Sou depósito — quero ser parceiro
          </a>
        </div>
      </div>
      <div class="hidden lg:block" />
      <div class="mt-10 flex justify-center lg:hidden">
        <NuxtImg
          src="/images/hero-mascot.png"
          alt="Mascote do Chama Dudu com celular"
          class="w-[420px] max-w-none select-none sm:w-[480px]"
          loading="eager"
        />
      </div>
    </div>
  </section>
</template>
