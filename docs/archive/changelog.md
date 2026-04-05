# CHANGELOG

## Unreleased
- Billing semanal: regra GMV < R$500 com taxa fixa menor e escada de 1% por R$500 (teto 5%).
- Confirmacao de entrega: job de botoes e pings 5/13 min para ENTREGUE_DEPOSITO.
- Depositos: ranking por SLA/issue/ratings e botao Mandar valor quando falta total.
- Webhook: deduplicacao com fallback de messageId e guardrails de config.
- Cliente: nudge de pedido abandonado com botao CONTINUAR e opt-in “me avisa quando abrir”.
- Robo: ping-me quando abrir (opt-in) e promo semanal com resumo 7d + sugestoes.
- Auditoria: logs para sponsor lead, complaints/low rating, promo e receipt render.
- Cliente: fechamento de ciclo (DONE + clear pointer) em transacao no CHEGOU.
- Dedupe inbound: TTL em wa_dedupe.expiresAt (default 14 dias).
- Billing: indice depositoId + fulfillmentStatus + acceptedAt para query semanal.
- WhatsApp: log de falha de interactive com interactiveFailedAtMs (event log).
