<script setup lang="ts">
const route = useRoute()
const requestUrl = useRequestURL()

useSeoMeta({
  title: 'Termos de uso | Chama Dudu',
  description: 'Termos de uso do Chama Dudu para clientes e depósitos parceiros.',
  ogTitle: 'Termos de uso | Chama Dudu',
  ogDescription: 'Regras de uso do bot do Chama Dudu no WhatsApp.',
  ogImage: `${requestUrl.origin}/og.png`,
  twitterCard: 'summary_large_image',
  twitterTitle: 'Termos de uso | Chama Dudu',
  twitterDescription: 'Regras de uso do bot do Chama Dudu no WhatsApp.',
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
        <h1 class="text-3xl font-extrabold text-neutral-900">Termos de uso</h1>
        <p class="mt-3 text-sm text-neutral-700">
          Ao usar o Chama Dudu, você concorda com as regras abaixo. Se não concordar, não utilize o serviço.
        </p>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">1. O que é o Chama Dudu</h2>
          <p>
            O Chama Dudu é um bot no WhatsApp que conecta clientes a depósitos de bebidas abertos no bairro.
            O bot lista opções, encaminha pedidos e facilita a comunicação.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">2. Taxas e condições</h2>
          <p>
            Para clientes, pode haver taxa de serviço de R$ 0,99 cobrada na entrega, quando aplicável.
            Para depósitos, o beta é sem mensalidade. Caso haja cobrança futura, avisaremos com antecedência.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">3. Responsabilidades do cliente</h2>
          <p>
            O cliente deve informar o bairro corretamente, escolher o depósito e combinar entrega e pagamento
            diretamente com o estabelecimento.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">4. Responsabilidades do depósito</h2>
          <p>
            O depósito é responsável por atualizar seu status (abrir, fechar, status) e cumprir o que foi combinado
            com o cliente, incluindo disponibilidade e entrega.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">5. Áreas atendidas</h2>
          <p>
            O Chama Dudu funciona apenas em áreas ativas. A lista atual pode ser consultada em Onde funciona.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">6. Limitações</h2>
          <p>
            O Chama Dudu não garante disponibilidade de produtos, prazos ou entrega. O bot apenas intermedia o contato.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">7. Alterações</h2>
          <p>
            Podemos atualizar estes termos para melhorar o serviço. Mudanças relevantes serão comunicadas.
          </p>
        </section>

        <section class="mt-8 space-y-3 text-sm text-neutral-700">
          <h2 class="text-lg font-bold text-neutral-900">8. Contato</h2>
          <p>
            Em caso de dúvidas, fale com a equipe do Chama Dudu pelo WhatsApp oficial.
          </p>
        </section>
      </main>
      <AppFooter />
    </div>
  </div>
</template>
