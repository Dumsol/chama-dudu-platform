# 🟢 Chama Dudu: O Manual do Sistema

Este documento detalha o funcionamento operacional, a personalidade da marca e as regras de negócio que regem o ecossistema do **Chama Dudu**.

---

## 🤖 1. A Persona: Quem é o Dudu?

O **Dudu** não é apenas um bot; ele é o parceiro de confiança do usuário e do dono do depósito.

- **Personalidade**: Extrovertido, prestativo e ágil.
- **Tom de Voz**: Informal, mas profissional. Usa linguagem direta para resolver o problema do cliente ("Sede? Deixa com o Dudu!").
- **Cumprimentação (Greetings)**: 
  - Sempre começa com um "Olá!", seguido de emojis amigáveis (🍺, 🧊, 🚀).
  - Exemplo: *"Olá! Aqui é o Dudu. O que vamos pedir hoje para animar o dia?"*
- **Visual**: Representado por um mascote herói, sempre pronto para a entrega.

---

## 📲 2. Interação e Fluxo de Mensagens

O sistema utiliza a interface do WhatsApp para guiar o usuário através de **Botões Interativos** e **Listas de Opções**.

### Fluxo de Compra:
1. **Início**: O cliente manda um "Oi" para o número oficial.
2. **Localização**: O Dudu solicita o bairro ou com botão de localização ou o endereço em texto. 
3. **Seleção de Depósito**: O Dudu escolhe os depósitos mais próximos/abertos.
4. **Carrinho**: O cliente seleciona os itens e quantidades.
5. **Finalização**: O Dudu resume o pedido, inclui a **Taxa de Serviço (R$ 0,99)** e encaminha para o WhatsApp do depósito.

---

## ❌ 3. Sistema de Cancelamento

O cancelamento é projetado para ser justo e evitar prejuízos aos parceiros:

- **Pelo Cliente**: 
  - Pode ser feito até o depósito confirmar o "Saiu para entrega". 
  - Após o despacho, o cancelamento exige abertura de **Ticket de Suporte**.
- **Pelo Depósito**:
  - Se o item acabar (ruptura de estoque), o depósito pode cancelar informando o motivo via comando ou dizendo em palavras no bot.
  - O Dudu avisa o cliente imediatamente e sugere/procura outro depósito próximo.

---

## 🎫 4. Abertura de Tickets

Sempre que algo sai do fluxo padrão, o sistema de tickets entra em ação:

- **Motivos**: Atraso excessivo, erro no troco, produto incorreto.
- **Como abrir**: O usuário clica no botão "Preciso de Ajuda" no resumo do pedido.
- **Resolução**: O ticket é encaminhado para o time de **Ops do Chama Dudu** (Painel Admin), que intermedeia o conflito.
Não há suporte humano como "quero falar com um humano agora". Tudo é baseado em ticket de suporte pós compra.

---

## ⭐ 5. Score do Depósito (Dudu Score)

A reputação é o que garante a qualidade da plataforma. O **Dudu Score** (0 a 100) é calculado com base em:

1. **Tempo de Resposta**: Depósitos que atendem rápido ganham mais pontos.
2. **Índice de Conclusão**: Baixa taxa de cancelamento = Score alto.
3. **Avaliação do Cliente**: O Dudu pergunta "O que achou da entrega?" após 60 minutos.
4. **Status Online**: Manter o horário de funcionamento atualizado conta pontos.
5. **Quantidade de pedidos**: Depósitos que recebem mais pedidos ganham mais pontos.
6. **Quantidade de avaliações**: Depósitos que recebem mais avaliações ganham mais pontos.
7. **Quantidade de tickets abertos**: Depósitos que recebem mais tickets abertos perdem pontos.
8. **Quantidade de cancelamentos**: Depósitos que recebem mais cancelamentos perdem pontos.
9. **O Sistema de Robin Rond** Otimizado com metricas para não ficar somente em um unico deposito rigoroso. 

*Depósitos com Score baixo perdem prioridade na lista de exibição para os clientes.*

---

## 📩 6. Envio de Mensagens e Notificações

Tecnicamente, cada interação gera um evento via **GCP Cloud Functions** (`dudu_opsAppV1`).
- **Push**: Notificações automáticas para depósitos sobre novos pedidos.
- **Status Sync**: Quando um depósito altera o status (abre/fecha), todos os clientes na área são impactados em tempo real na interface web.

---

## 💰 7. Regras Financeiras
- **Preços**: Definidos por cada depósito.
- **Taxa Dudu**: Valor fixo de conveniência aplicado em cada transação bem-sucedida.
- **Pagamento**: Feito diretamente ao entregador (PIX, Cartão ou Dinheiro), garantindo fluxo de caixa imediato para o parceiro.

O Depoisto paga uma taxa de R$2.00 sobre o pedido total do pedido. Debitado semanalmente dele pelo sistema. Com geração de um QR code para pagamento via PIX.
---
*"O Dudu está aqui para ajudar!"* 🚀
