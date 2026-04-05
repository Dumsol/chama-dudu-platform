<script setup lang="ts">
const route = useRoute()
const requestUrl = useRequestURL()

useSeoMeta({
  title: 'Política de privacidade | Chama Dudu',
  description: 'Como o Chama Dudu trata dados de clientes e depósitos.',
  ogTitle: 'Política de privacidade | Chama Dudu',
  ogDescription: 'Dados usados para operar o bot no WhatsApp.',
  ogImage: `${requestUrl.origin}/og.png`,
  twitterCard: 'summary_large_image',
  twitterTitle: 'Política de privacidade | Chama Dudu',
  twitterDescription: 'Dados usados para operar o bot no WhatsApp.',
  twitterImage: `${requestUrl.origin}/og.png`
})

useHead({
  link: [{ rel: 'canonical', href: `${requestUrl.origin}${route.path}` }]
})
</script>

<template>
  <div class="min-h-screen bg-neutral-200 py-10">
    <div class="mx-auto w-full max-w-[960px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
      <AppHeader />
      <main class="dudu-container py-12">
        <h1 class="text-3xl font-extrabold text-neutral-900">Política de privacidade</h1>
        <p class="mt-3 text-sm text-neutral-700">
          Esta política explica quais dados o Chama Dudu coleta e como utiliza para operar o serviço.
        </p>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">1. Dados coletados</h2>
          <p>
            Coletamos dados fornecidos por você, como WhatsApp, nome do depósito, bairro e informações do pedido.
            Esses dados são usados para conectar clientes e depósitos.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">2. Como usamos os dados</h2>
          <p>
            Usamos os dados para listar depósitos abertos, encaminhar pedidos, manter registros básicos e melhorar
            a operação do bot.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">3. Armazenamento</h2>
          <p>
            No MVP, os dados são guardados em armazenamento local do servidor para garantir o funcionamento do serviço.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">4. Cookies</h2>
          <p>
            Usamos cookies apenas para manter sessões de admin e depósito. Esses cookies são httpOnly e sameSite=Lax.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">5. Compartilhamento</h2>
          <p>
            Os dados de pedidos são compartilhados somente entre cliente e depósito escolhido para viabilizar a entrega.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">6. Seus direitos</h2>
          <p>
            Você pode solicitar atualização ou exclusão dos seus dados. Entre em contato pelo WhatsApp oficial.
          </p>
        </section>
      </main>
      <AppFooter />
    </div>
  </div>
</template>
