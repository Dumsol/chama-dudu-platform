# arquitetura

## Visao geral
Este repo contem apenas backend (Firebase Functions v2 + Firestore). O fluxo principal e WhatsApp -> webhook -> handlers -> Firestore -> envio.

## Estrutura
- `functions/src/app/http`: endpoints HTTP e webhooks.
- `functions/src/jobs`: cron runner e tarefas agendadas.
- `functions/src/modules`: regras de negocio (orders, billing, whatsapp, ops).
- `functions/src/infra`: config, firestore paths, logging, http client.
- `docs`: documentacao curta e direta; arquivos antigos em `docs/archive`.

## Fluxos principais
1. WhatsApp webhook recebe mensagens/status.
2. Resolve tenant via `platform/channelDirectory/directory/{phone_number_id}`.
3. Dedupe, rate limit, session, e roteamento.
4. Persistencia em Firestore e envio via WhatsApp.
5. Billing semanal via Banco Inter (PIX), com reconciliacao e bloqueio de inadimplentes.

## Pre-cadastro operacional (deposito)
- Entrada HTTP: `POST /depositoRegister` via `dudu_depositoRegisterV1`.
- DDD suportado: cria pre-cadastro `pending_confirmation` e dispara template Meta.
- DDD nao suportado: registra como `unsupported_region`.
- Confirmacao via WhatsApp avanca por `confirmationStep` ate `completed`.
- Status operacionais usados:
  - `pending_confirmation`, `collecting_details`, `awaiting_location`, `confirmed`, `unsupported_region`, `abandoned`, `failed_delivery`, `manual_review`.

Visao operacional:
- Operacoes de Admin e Parceiros via `dudu_adminOpsV1`, `dudu_partnerAuthSetupV1` e `dudu_partnerUpdatePromoV1`.
- Diagnosticos via `dudu_diagHttpV1`.


## Agendamentos
- `dudu_cronRunnerV1` (Functions v2) dispara a cada 3 minutos.
- O runner decide o que rodar por janela/intervalo e usa `job_locks` para idempotencia.

## Firestore
Base path: `tenants/{tenantId}/products/dudu` (ver `functions/src/infra/firestore/duduPaths.ts`).
Indices estao em `firestore.indexes.json` e resumidos em `docs/firestore-indexes.md`.
