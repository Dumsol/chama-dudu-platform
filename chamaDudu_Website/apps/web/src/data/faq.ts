export type FaqItem = {
  question: string
  answer: string
  audience: 'Cliente' | 'Depósito'
}

export const faqItems: FaqItem[] = [
  {
    question: 'Como funciona o Chama Dudu?',
    answer: 'Você manda o bairro no WhatsApp e recebe a lista de depósitos abertos agora.',
    audience: 'Cliente'
  },
  {
    question: 'Preciso baixar aplicativo?',
    answer: 'Não. Tudo acontece pelo WhatsApp.',
    audience: 'Cliente'
  },
  {
    question: 'Qual é a taxa para cliente?',
    answer: 'R$ 0,99 cobrada na entrega, quando aplicável.',
    audience: 'Cliente'
  },
  {
    question: 'Como escolho o depósito?',
    answer: 'Dudu lista as opções e você responde com a escolhida.',
    audience: 'Cliente'
  },
  {
    question: 'Quem faz a entrega?',
    answer: 'O depósito escolhido combina entrega e pagamento com você.',
    audience: 'Cliente'
  },
  {
    question: 'Como o depósito abre e fecha?',
    answer: 'Envia "abrir", "fechar" ou "status" no WhatsApp.',
    audience: 'Depósito'
  },
  {
    question: 'Tem mensalidade para depósito?',
    answer: 'No beta, não. Se houver cobrança futura, avisamos com antecedência.',
    audience: 'Depósito'
  },
  {
    question: 'Posso receber pedidos fora do horário?',
    answer: 'Só quando você marcar o status como aberto.',
    audience: 'Depósito'
  },
  {
    question: 'Como acompanho pedidos?',
    answer: 'No painel do depósito ou pelo WhatsApp, conforme preferir.',
    audience: 'Depósito'
  },
  {
    question: 'Em quais bairros funciona?',
    answer: 'Veja a lista atual em Onde funciona. Atendemos apenas áreas ativas.',
    audience: 'Cliente'
  }
]
