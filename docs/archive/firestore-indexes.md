# FIRESTORE_INDEXES

## orders
- `status` ASC, `notifiedAt` ASC
  - SLA: NOTIFIED > 6min (reroute/timeout).
- `status` ASC, `acceptedAt` ASC
  - SLA: ACCEPTED por janela de tempo (presumido) e metricas.
- `status` ASC, `valorPropostoAt` ASC
  - SLA: valor proposto sem confirmacao.
- `status` ASC, `updatedAt` ASC
  - F1: nudge de pedido abandonado (CREATED incompleto).
- `status` ASC, `fulfillmentStatus` ASC, `updatedAt` ASC
  - SLA: A_CAMINHO sem update (ping).
- `depositoId` ASC, `fulfillmentStatus` ASC, `acceptedAt` ASC
  - Legado: queries antigas de billing (aceite).
- `depositoId` ASC, `fulfillmentStatus` ASC, `deliveredAt` ASC
  - Billing semanal Q1 (entregue confirmado/presumido).

## issues
- `status` ASC, `createdAt` ASC
  - RoboOps: ping de issue velha.
- `orderId` ASC, `status` ASC
  - getOpenIssueByOrder (idempotencia).
- `orderId` ASC, `type` ASC, `status` ASC
  - getOpenIssueByOrder (com type).

## depositos
- `bairro` ASC, `status` ASC
  - Listagem por bairro (roteamento).

## promo_history
- `depositoId` ASC, `concludedAt` DESC
  - Promo Inteligente: consulta ultimos 15 dias por deposito (limite 500).

## billingCycles
- `depositoId` ASC, `status` ASC
  - Desbloqueio de depósitos (clearDepositoInadimplenteIfNoOverdueOpen) e reconciliação semanal (invoice status).
- `inter.txid` ASC
  - markPaidByInterPixEvent e reconcileOpenCycles localizam ciclos via txid.

## ttl
- `wa_dedupe.expiresAt` (TTL)
  - Dedupe inbound WhatsApp: expira documentos antigos.

## notas (este ciclo)
- Nenhum indice novo alem dos listados acima.
