export type FaqItem = {
  question: string
  answer: string
}

export const siteContent = {
  brand: 'Chama o Dudu',
  shortBrand: 'Chama Dudu',
  tagline: 'Descubra quem está aberto no seu bairro agora.',
  ctaLabel: 'Chamar no WhatsApp',
  nav: [
    { label: 'Como funciona', to: '/#como-funciona' },
    { label: 'Benefícios', to: '/#beneficios' },
    { label: 'Depósitos parceiros', to: '/#parceiro' },
    { label: 'FAQ', to: '/#faq' }
  ],
  landing: {
    title: 'Chama o Dudu - Descubra depósitos abertos no seu bairro pelo WhatsApp',
    description:
      'Envie uma mensagem no WhatsApp e receba agora a lista de depósitos abertos perto de você. Sem baixar app. Depósitos podem se cadastrar e ser encontrados.',
    headline: 'Chama o **Dudu** e descobre quem está aberto no teu bairro agora.',
    subheadline:
      'Você manda uma mensagem no WhatsApp e o Dudu te responde com os depósitos abertos perto de você, rápido, simples e sem baixar app.',
    howItWorksTitle: 'Como funciona',
    howItWorksSteps: [
      'Você manda uma mensagem no WhatsApp.',
      'O Dudu entende o teu bairro e o tipo de pedido.',
      'Recebe a lista de depósitos abertos com horários.',
      'Escolhe retirada ou entrega e continua no WhatsApp.'
    ],
    benefitsTitle: 'Benefícios',
    benefits: [
      'Encontre depósito aberto na hora.',
      'Economiza tempo (sem ligar pra vários lugares).',
      'Funciona no WhatsApp, sem app.',
      'Ajuda depósitos do bairro a vender mais.',
      'Atualização fácil de status (abrir, fechar).',
      'Experiência rápida e objetiva.'
    ]
  },
  appPage: {
    title: 'App Chama o Dudu | Como funciona para cliente e depósito',
    description:
      'Entenda o App Chama o Dudu: passos, benefícios, FAQ e pré-cadastros para depósito. Operação pelo WhatsApp com foco em velocidade.',
    headline: 'App Chama o Dudu: operação simples no WhatsApp',
    subheadline:
      'Cliente encontra depósito aberto e depósito controla status com abrir, fechar e status.',
    ctaTitle: 'Quer colocar teu depósito no Chama o Dudu?',
    ctaDescription: 'Preenche o pré-cadastro e a gente ativa teu onboarding.',
    socialProofTitle: 'Prova social',
    socialProof: [
      {
        quote: 'Achei um depósito aberto em 30 segundos. Salvou demais.',
        author: 'Cliente beta'
      },
      {
        quote: 'Comecei a aparecer pros clientes do bairro e aumentou movimento.',
        author: 'Depósito parceiro'
      }
    ]
  },
  faq: [
    {
      question: 'Preciso baixar app para usar o Chama o Dudu?',
      answer: 'Não. Funciona direto no WhatsApp.'
    },
    {
      question: 'Como o Dudu sabe meu bairro?',
      answer: 'Você informa o bairro ou compartilha localização.'
    },
    {
      question: 'É grátis?',
      answer: 'Sim, o serviço custa R$ 0,99 BRL por pedido finalizado (pago pelo cliente no ato da entrega ao depósito) e R$ 2,00 BRL por pedido finalizado para o estabelecimento parceiro. O faturamento é semanal.'
    },
    {
      question: 'Como o depósito atualiza status?',
      answer: 'Comandos: abrir, fechar e status.'
    },
    {
      question: 'Tem entrega?',
      answer: 'Depende do depósito; o MVP foca em disponibilidade.'
    },
    {
      question: 'Como cadastrar meu depósito?',
      answer: 'Pelo formulário com validação por WhatsApp.'
    },
    {
      question: 'Meus dados ficam seguros?',
      answer: 'Os dados são tratados com responsabilidade.'
    },
    {
      question: 'É WhatsApp oficial?',
      answer: 'Integração oficial via WhatsApp Cloud API.'
    }
  ] as FaqItem[]
}
