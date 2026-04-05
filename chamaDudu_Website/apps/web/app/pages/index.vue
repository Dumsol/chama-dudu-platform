<script setup lang="ts">
const config = useRuntimeConfig()
const route = useRoute()
const requestUrl = useRequestURL()

const canonicalUrl = computed(() => `${requestUrl.origin}${route.path}`)
const ogImage = computed(() => `${requestUrl.origin}/og.png`)

useSeoMeta({
  title: 'Chama Dudu | Descobre quem tá aberto no teu bairro',
  description: 'Você chama no WhatsApp. O Dudu encontra depósitos abertos e manda o pedido pronto.',
  ogTitle: 'Chama Dudu | Descobre quem tá aberto no teu bairro',
  ogDescription: 'Chama Dudu conecta você aos depósitos abertos da área via WhatsApp, sem app.',
  ogImage,
  twitterCard: 'summary_large_image',
  twitterTitle: 'Chama Dudu | Descobre quem tá aberto no teu bairro',
  twitterDescription: 'WhatsApp + Dudu = pedidos sem app.',
  twitterImage: ogImage
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl.value }],
  script: [
    {
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Chama Dudu',
        url: requestUrl.origin,
        logo: `${requestUrl.origin}/favicon.png`
      })
    },
    {
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Chama Dudu',
        url: requestUrl.origin
      })
    }
  ]
})
</script>

<template>
  <div class="min-h-screen bg-neutral-200 py-[52px]">
    <div class="mx-auto w-full max-w-[1334px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
      <AppHeader />
      <main class="bg-neutral-900 px-6 py-16 text-white sm:px-10 lg:px-14">
        <div class="dudu-container">
          <div class="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p class="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-200">Chama Dudu</p>
              <h1 class="mt-4 text-3xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">
                Descobre quem tá aberto no teu bairro agora.
              </h1>
              <p class="mt-4 max-w-xl text-lg leading-relaxed text-white/80">
                Você chama no WhatsApp. O Dudu acha um depósito e te manda o pedido pronto.
              </p>
              <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  :href="config.public.whatsappUrl"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex w-full items-center justify-center rounded-full bg-dudu-green px-8 py-3 text-base font-semibold text-white shadow-[0_12px_30px_rgba(34,139,78,0.35)] transition hover:brightness-110 sm:w-auto"
                >
                  Chamar no WhatsApp
                </a>
                <NuxtLink
                  to="/cliente"
                  class="text-sm font-semibold text-white underline underline-offset-4"
                >
                  Ficou com dúvida? Entenda melhor
                </NuxtLink>
              </div>
            </div>
            <div class="hidden items-center justify-end lg:flex">
              <NuxtImg
                src="/images/hero-mascot.png"
                alt="Mascote do Chama Dudu com celular"
                class="w-[320px] max-w-none select-none"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </main>
      <AppFooter />
    </div>
  </div>
</template>
