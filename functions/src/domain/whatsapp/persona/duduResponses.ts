/**
 * Central repository for all new bot response strings added during the
 * incremental refactor. Existing strings in responseComposer.ts,
 * personaLibrary.ts, and copy.ts will migrate here in a future pass.
 *
 * Each key exposes a function so we can add variants later without
 * changing call sites.
 */

import { BotResponse } from "../types.js";

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)] ?? list[0];
}

export const DuduResponses = {
  /** Shown when a duplicate/concurrent message is silently dropped. */
  concurrentDrop: (): BotResponse => ({
    body: pick([
      "Eita, recebi tua mensagem duas vezes, boy! O Dudu tá processando aqui, relaxa que eu já cheguei. 🤙",
      "Oxe, chegou duplicado! Tô no corre aqui, aguenta aí um segundinho que eu já te respondo. 🤙",
    ]),
  }),

  /** Fuzzy match — ask the user to confirm the neighborhood we guessed. */
  neighborhoodFuzzy: (bairro: string): BotResponse => ({
    body: pick([
      `É no *${bairro}*, visse boy? Confirma pro Dudu que eu agilizo o lado.`,
      `Entendi *${bairro}*, tá na agulha? Me dá o OK ou corrige aí pra gente não errar o bote!`,
      `Parece o *${bairro}* pra mim — confirma que o Dudu já vai buscando o canal!`,
    ]),
    buttons: [
      { id: "sim", title: "Sim, é esse" },
      { id: "nao", title: "Não, é outro" },
    ],
  }),

  /** Fallback after 3 failed neighborhood attempts — list available options. */
  neighborhoodListFallback: (bairros: string[]): BotResponse => {
    const list = bairros.map((b) => `• ${b}`).join("\n");
    return {
      body: pick([
        `Rapaz, não tô pegando o bairro não 😅 Escolhe um aí:\n${list}`,
        `Vixe, errei feio! Me diz qual é o teu bairro:\n${list}`,
      ]),
    };
  },

  /** Confirm a raw (free-text) product order before forwarding. */
  productRawConfirm: (product: string): BotResponse => ({
    body: pick([
      `Anotei: *${product}*. Posso encaminhar pro depósito?`,
      `Show! *${product}* registrado. Confirma que eu mando agora?`,
    ]),
    buttons: [
      { id: "sim", title: "Pode mandar!" },
      { id: "nao", title: "Ainda não" },
    ],
  }),

  /** Sent when fallbackCount >= MAX_FALLBACKS — resets conversation. */
  loopBreaker: (): BotResponse => ({
    body: pick([
      "Vixe, travei aqui, boy! 😅 Me diz do zero: qual teu bairro e o que quer pedir? Bora resetar!",
      "Oxe, perdi o fio da meada! Me conta de novo: teu bairro e o pedido que o Dudu resolve.",
      "Vixe, me confundi todinho! Começa de novo: bairro + o que quer beber? 🍺",
    ]),
  }),

  /** No coverage for the neighborhood. */
  noDeposito: (bairro: string): BotResponse => ({
    body: pick([
      `Não tem entrega no *${bairro}* agora 😕 Quer tentar outro bairro ou ver depois?`,
      `Vixe, sem cobertura em *${bairro}* por enquanto. Tenta outro bairro?`,
    ]),
  }),

  /** Simulated availability check response. */
  availabilityCheck: (bairro: string, available: boolean): BotResponse => {
    if (available) {
      return {
        body: `Tá na agulha! Achei o canal no *${bairro}*. Bora fechar esse pedido agora, visse? ✅`,
        buttons: [
          { id: "cliente_confirmar_pedido", title: "✅ Confirmar" },
          { id: "cancelar", title: "❌ Cancelar" },
        ],
        stickerName: "resolve",
      };
    }
    return {
      body: `Vixe boy... No *${bairro}* agora tá osso, tem ninguém aberto. Quer tentar outro bairro ou deixar pra mais tarde?`,
      stickerName: "problema_tecnico",
    };
  },

  /** Order declined by depósito. */
  orderDeclined: (motivo?: string): BotResponse => {
    const suffix = motivo ? ` Motivo: ${motivo}.` : "";
    return {
      body: pick([
        `Rapaz, o depósito não conseguiu atender agora.${suffix} Já tô buscando outra opção!`,
        `Oxe, deu recusa no depósito.${suffix} Vou tentar outro pra você!`,
      ]),
    };
  },

  /** Ask user to share location or type neighborhood name. */
  askBairro: (): BotResponse => ({
    body: pick([
      "Me diz aí onde tu tá, boy! Manda o nome do bairro ou compartilha tua localização 📍 que o Dudu acha mais rápido.",
      "Bora achar tua área! 📍 Toca o botão e solta o pin, ou digita o nome do bairro (ex: Janga, Pau Amarelo, Centro).",
    ]),
    stickerName: "esperando",
    isLocationRequest: true,
  }),

  /** Confirm the order and forward to depósito. */
  confirmOrder: (bairro: string, produto: string): BotResponse => ({
    body: pick([
      `Confirma aí: é *${produto}* no *${bairro}*, visse? Responde com "sim" pra eu dar o bote!`,
      `Então fechou: *${produto}* em *${bairro}*. Tá na agulha? Me confirma que eu mando na hora!`,
    ]),
    buttons: [
      { id: "sim", title: "✅ Sim, tá certo" },
      { id: "nao", title: "✏️ Não, mudar" },
    ],
    stickerName: "fazendo_pedido",
  }),

  /** Order forwarded to depósito successfully. */
  orderForwarded: (): BotResponse => ({
    body: pick([
      "Mandei pro depósito! 🚀 Aguarda a confirmação dele em segundinhos.",
      "Pedido enviado! ⏳ Deixa ele confirmar aí.",
    ]),
  }),

  /** Order accepted and preparing. */
  orderAccepted: (eta: number): BotResponse => ({
    body: pick([
      `Arretado! ✅ O depósito já deu o OK. Chega nuns *${eta}* minutinhos. Fica no QAP! 🏍️`,
      `Show de bola! Tá preparando. Aproximadamente *${eta}* min pra encostar aí. Visse?`,
    ]),
    stickerName: "pedido",
  }),

  /** Order is being prepared. */
  orderPreparing: (): BotResponse => ({
    body: pick([
      "Teu pedido tá sendo separado! Logo logo sai.",
      "Separando seu pedido agora!",
    ]),
  }),

  /** Order out for delivery. */
  orderDispatched: (): BotResponse => ({
    body: pick([
      "Saiu pra entrega! 🏍️ Tá a caminho!",
      "Pedido saiu! 🚚 Já já chega aí!",
    ]),
  }),

  /** Order delivered. */
  orderDelivered: (): BotResponse => ({
    body: pick([
      "Entregue! 🎉 Aproveita! Qualquer coisa é só chamar.",
      "Chegou! 🎊 Aproveita e qualquer coisa tô aqui.",
    ]),
  }),

  /** All depósitos declined. */
  orderExhausted: (): BotResponse => ({
    body: pick([
      "Poxa, nenhum depósito conseguiu atender agora. Tenta em outro momento!",
      "Vixe, ninguém conseguiu pegar o pedido agora. Volta daqui a pouco?",
    ]),
  }),

  /** Generic fallback. */
  fallback: (): BotResponse => ({
    body: pick([
      "Vixe, não entendi nada, boy! 😅 Fala pro Dudu de novo que eu agilizo pro teu lado.",
      "Oxente, quase não capto! Tô contigo aqui, manda de novo do teu jeito que eu te ajudo.",
    ]),
    stickerName: "esperando",
  }),

  /** Disambiguation. */
  disambiguation: (): BotResponse => ({
    body: pick([
      "Me diz: quer fazer um pedido, consultar horário, ou outra coisa?",
      "Deixa eu entender: é pedido, informação, ou quer falar com o depósito?",
    ]),
    buttons: [
      { id: "cliente_fazer_pedido", title: "🛒 Fazer Pedido" },
      { id: "cliente_consultar_horario", title: "🕒 Horários" },
    ],
  }),

  /** Order flow start. */
  orderStartPrompt: (): BotResponse => ({
    body: pick([
      "Massa! 🍺 Agora me diz: o que vai levar pra refrescar? Uma gelada, um refri ou aquele destilado bruto?",
      "Arretado! Me conta o que quer beber e se é pra entrega ou se tu vem buscar.",
    ]),
    stickerName: "fazendo_pedido",
  }),
  /** Request more details. */
  orderNeedDetails: (): BotResponse => ({
    body: pick([
      "Rapaz, pra eu encaminhar certinho me manda os itens do pedido numa frase curta, tá bom?",
      "Me explica melhor o que você quer pedir, tá?",
    ]),
  }),

  /** Order confirmation (listing options). */
  orderConfirmation: (bairro: string, optionsText: string): BotResponse => ({
    body: `Achei a melhor opção agora em *${bairro}*:\n${optionsText}\n\nPosso encaminhar?`,
    buttons: [
      { id: "sim", title: "Sim, pode mandar" },
      { id: "nao", title: "Não, cancelar" },
    ],
  }),

  /** Order session expired. */
  orderExpired: (): BotResponse => ({
    body: pick([
      "Oxe, esse pedido expirou por tempo! Sem problema, me manda de novo os detalhes que eu refaço aqui rapidinho.",
      "Faz tempo que não se fala! Manda teu bairro de novo pra continuar.",
    ]),
  }),

  /** Depósito declined, rerouting. */
  orderRerouted: (): BotResponse => ({
    body: pick([
      "O depósito anterior não conseguiu atender. Já encaminhei para outro. Te atualizo por aqui.",
      "Vou tentar outro depósito pra você. Um segundo!",
    ]),
  }),

  /** Rollout hold. */
  orderRolloutHold: (): BotResponse => ({
    body: pick([
      "Tua região ainda tá em liberação gradual pra encaminhamento automático. Enquanto isso, te mostro os depósitos abertos agora.",
      "Sua região está em liberação gradual do encaminhamento automático. Por enquanto te mostro os depósitos abertos.",
    ]),
  }),

  /** Internal error. */
  orderInternalError: (): BotResponse => ({
    body: pick([
      "Égua, deu um probleminha aqui no encaminhamento! Me chama de novo em seguida que eu retomo contigo sem perder nada.",
      "Tive um erro aqui. Tenta de novo em instantes!",
    ]),
  }),

  /** Indication request. */
  indicacaoAsk: (): BotResponse => ({
    body: pick([
      "Conhece algum depósito que poderia atender aí no teu bairro? Me passa o contato!",
      "Você conhece algum depósito de bebidas aí que poderia entrar com a gente?",
    ]),
  }),

  /** Indication refused. */
  indicacaoRecused: (): BotResponse => ({
    body: pick([
      "Tá bom! Qualquer coisa é só chamar o Dudu aqui.",
      "Sem problema! Se precisar de algo é só chamar.",
    ]),
  }),

  /** Indication accepted. */
  indicacaoAccepted: (contato: string): BotResponse => ({
    body: pick([
      `Mandou bem! Anotei aqui e vou entrar em contato com ${contato}. 🤝`,
      `Obrigado pela dica! Vou verificar ${contato} e entro em contato.`,
    ]),
  }),

  /** Main menu greeting — shown with interactive buttons. */
  menuGreeting: (): BotResponse => ({
    body: pick([
      "E aí, boy! O Dudu tá na área. Bora agilizar esse pedido ou tu quer ver os horários? Fala pro teu parceiro! 🤙",
      "Fala, cabra! Na paz? Como é que o Dudu pode te ajudar hoje? Escolhe aí embaixo e bora simbora! 🤙",
      "Opa! Tranquilidade? O Dudu tá no QAP. Me diz o que tu precisa que eu resolvo agora! 🤙",
    ]),
    buttons: [
      { id: "cliente_fazer_pedido", title: "🛒 Fazer Pedido" },
      { id: "cliente_consultar_horario", title: "🕒 Horários" },
      { id: "ajuda", title: "❓ Ajuda" },
    ],
    stickerName: "hello",
  }),

  /** Help text. */
  menuHelp: (): BotResponse => ({
    body: "Eu posso te ajudar com: buscar depósito aberto, salvar teu bairro, te orientar em entrega e horário. O que precisa?",
    buttons: [
      { id: "cliente_fazer_pedido", title: "🛒 Fazer Pedido" },
      { id: "ajuda", title: "❓ Ajuda" },
    ],
  }),

  /** Pre-cadastro. */
  preCadastroStart: (): BotResponse => ({
    body: pick([
      "Boa! Me diz o nome do seu depósito.",
      "Show! Qual é o nome do teu depósito?",
    ]),
  }),

  preCadastroAskCnpj: (): BotResponse => ({
    body: pick([
      "Me passa o CNPJ (só números).",
      "Qual é o CNPJ? Manda só os números, tranquilo.",
    ]),
  }),

  preCadastroAskBairros: (): BotResponse => ({
    body: pick([
      "Quais bairros você atende? Me lista aí.",
      "Que bairros você cobre? Me passa a lista.",
    ]),
  }),

  preCadastroAskModo: (): BotResponse => ({
    body: pick([
      "Você faz entrega, retirada ou os dois?",
      "Trabalha com entrega, retirada ou ambos?",
    ]),
  }),

  preCadastroAskHorario: (): BotResponse => ({
    body: pick([
      "Qual seu horário de atendimento? (ex: 8h às 22h)",
      "De que hora até que hora você funciona?",
    ]),
  }),

  preCadastroAskLocation: (): BotResponse => ({
    body: pick([
      "Última etapa: me manda o pin da localização oficial do depósito. 📍",
      "Agora me compartilha a localização do teu depósito aqui no WhatsApp. 📍",
    ]),
  }),

  preCadastroConcluido: (): BotResponse => ({
    body: pick([
      "Pré-cadastro feito! Em breve nossa equipe entra em contato.",
      "Cadastro recebido! Vamos verificar e te avisar.",
      "Tá registrado! Vou entrar em contato com você em breve.",
    ]),
  }),

  /** Order cancellation. */
  orderCancelled: (): BotResponse => ({
    body: pick([
      "Pedido cancelado! Se quiser pedir de novo é só falar.",
      "Cancelado! Qualquer coisa tô aqui.",
    ]),
  }),

  cancelTooLate: (): BotResponse => ({
    body: pick([
      "Seu pedido já tá sendo preparado! Para cancelar agora fala direto com o depósito.",
      "Tarde demais — já tá em preparo. Contato direto com o depósito.",
    ]),
  }),

  noActiveOrder: (): BotResponse => ({
    body: "Não tem pedido ativo pra cancelar.",
  }),

  /** Social greeting. */
  greeting: (hasBairro: boolean): BotResponse => {
    const body = hasBairro
      ? pick([
        "E aí, boy! Já sei onde tu tá. O que vai levar hoje pra refrescar? 🍺",
        "Fala, cabra! Já tô com teu bairro aqui. Me diz o que tu quer beber que eu agilizo!",
      ])
      : pick([
        "E aí! Eu sou o Dudu, teu parceiro de plantão 🤙 Me diz aí qual é o teu bairro?",
        "Dudu na área! Bora agilizar esse pedido? Qual é o teu bairro, visse?",
      ]);
    return {
      body,
      stickerName: "hello",
    };
  },

  /** Help capabilities. */
  help: (): BotResponse => ({
    body: pick([
      "Eu posso: buscar depósito aberto, salvar teu bairro, te orientar em entrega e horário. O que precisa?",
      "Pode me perguntar sobre pedidos, entrega ou horários. Eu posso ajudar com o bairro também!",
    ]),
    buttons: [
      { id: "cliente_fazer_pedido", title: "🛒 Fazer Pedido" },
      { id: "ajuda", title: "❓ Ajuda" },
    ],
  }),

  /** Human fallback. */
  human: (): BotResponse => ({
    body: pick([
      "Tô contigo, boy! Aguenta aí que eu já tô chamando o pessoal pra te atender. Enquanto isso, o Dudu fica no QAP! 🤙",
      "Dale, parceiro! Já avisei aqui. O humano já já te responde, mas o Dudu continua na área pra o que precisar.",
    ]),
    stickerName: "deboa",
  }),

  /** Social closure. */
  closure: (): BotResponse => ({
    body: pick([
      "Fechou demais, boy! Precisar de mais nada, o Dudu tá aqui. Até a próxima, visse? 🤙",
      "Valeu demais, cabra arretado! Foi massa resolver com você. Qualquer coisa, tô na área no QAP. Fui! 🤙",
    ]),
    stickerName: "deboa",
  }),

  /** Small talk. */
  smallTalk: (): BotResponse => ({
    body: pick([
      "Dale, dale! Me diz teu bairro que o Dudu já te mostra quem tá pronto pra entregar agora mesmo! 🚀",
      "Massa! Bora agilizar esse lado. Me manda o bairro que eu acelero por aqui, visse?",
    ]),
    stickerName: "hello",
  }),

  /** Flow cancellation. */
  flowCanceled: (): BotResponse => ({
    body: pick([
      "Beleza, boy! Dei uma pausa aqui, sem estresse nenhum. Precisando, é só chamar o Dudu de novo! 🤙",
      "Dale, encerrei esse fluxo. Tô na área quando precisar, só dar o grito! Fui. 🤙",
    ]),
    stickerName: "deboa",
  }),

  /** Order summary before final confirmation. */
  orderSummary: (params: { items: string; bairro: string; total?: string }): BotResponse => ({
    body: pick([
      `*📝 RESUMO DO PEDIDO*\n\n*Itens:* ${params.items}\n*Bairro:* ${params.bairro}${params.total ? `\n*Total:* ${params.total}` : ""}\n\n*Tudo na agulha, boy?* Podemos confirmar esse pedido? ✅`,
    ]),
    buttons: [
      { id: "cliente_confirmar_pedido", title: "✅ Confirmar" },
      { id: "cliente_alterar_pedido", title: "✏️ Alterar" },
    ],
    stickerName: "resolve",
  }),

  /** Kosh Agent Response wrapper */
  koshSupport: (answer: string): BotResponse => ({
    body: answer,
    buttons: [
      { id: "voltar", title: "⬅️ Voltar" },
      { id: "abrir_ticket", title: "🎫 Abrir Ticket" },
    ],
    stickerName: "esperando",
  }),

  /** Loyalty Greeting for returning users within 30 days. */
  loyaltyGreeting: (name: string, lastItems: string): BotResponse => ({
    body: `Fala, *${name}*! 👋 Que bom te ver de novo, visse? \n\nQuer o de sempre (*${lastItems}*) ou quer fazer um novo pedido hoje? 🤙`,
    buttons: [
      { id: "cliente_o_de_sempre", title: "✅ O de sempre" },
      { id: "cliente_fazer_pedido", title: "🆕 Novo Pedido" },
    ],
    stickerName: "hello",
  }),
};
