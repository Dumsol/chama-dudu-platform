# MIGRATION_DUDU_BIGBANG

## 1. Inventory de paths Firestore por arquivo/função

Base V2 do produto dudu: `tenants/{tenantId}/products/dudu` (helpers em `functions/src/core/duduPaths.ts`).

| Arquivo / módulo | Funções principais | Paths Firestore acessados hoje | Observação |
| --- | --- | --- | --- |
| `functions/src/core/orderService.ts` | `createOrder`, `updateOrderStatus`, `updateFulfillmentStatus`, `saveOrderDoneSnapshot`, `ensurePublicCodeAndHash` | `chamadudu/app/orders/{orderId}`, `chamadudu/app/orders/{orderId}/events/{eventId}`, `chamadudu/app/orders_done/{orderId}`, `chamadudu/app/depositos/{depositoId}`, `chamadudu/app/routing_state/{bairro__canal}` (para ponteiros), `chamadudu/app/users/{waId}` (para client info) | Roteamento central: novo tenant deverá apontar para `tenants/{tenantId}/products/dudu/orders/...` etc. |
| `functions/src/core/depositoService.ts` | `listDepositosAbertosPorBairro`, `touchDepositoLastSeenAt`, `setDepositoStatus`, `markDepositoOffline` | `chamadudu/app/depositos/{depositoId}`, `chamadudu/app/depositosByWa/{waId}`, `chamadudu/app/routing_state/{bairro__canal}`, `chamadudu/app/job_locks/{lockId}` (para round robin) | Mudar para `tenants/{tenantId}/products/dudu/depositos/...` e manter pequenos locking docs. |
| `functions/src/core/clienteHandler.ts` | `handleClienteMessage`, `sendStatus`, `issue flow` | `chamadudu/app/users/{waId}`, `chamadudu/app/orders/{orderId}`, `chamadudu/app/issues/{issueId}`, `chamadudu/app/outboundMessages/{id}`, `chamadudu/app/outbox/{id}` | A nova estrutura deverá agrupar por tenant e produto, ex. `tenants/{tenantId}/products/dudu/users/{waId}`. |
| `functions/src/whatsapp/webhookHandler.ts` | `dudu_whatsappWebhookV1` (handler `whatsappWebhook`) | `chamadudu/app/wa_dedupe/{waMessageId}`, `chamadudu/app/inboundProcessed/{waMessageId}`, `chamadudu/app/users/{waId}`, `chamadudu/app/users/{waId}/messageSessions/{sessionId}` | Central de dedupe e sessão do WhatsApp. |
| `functions/src/whatsapp/send.ts` | `sendWhatsAppTextMessage`, `sendWhatsAppButtonsMessage`, `saveOutboxPending` | `chamadudu/app/outboundMessages/{correlationId}`, `chamadudu/app/outbox/{id}`, `chamadudu/app/job_locks/{lockId}` (para template rate limit) | Quem refatorar precisa apontar `tenants/{tenantId}/products/dudu/outboundMessages/` etc. |
| `functions/src/billing/billingService.ts` | `ensureWeeklyBillingCycleForDeposito`, `computeWeeklyTotalsForDeposito`, `reconcileOpenBillingCycles`, `markPaidByInterPixEvent` | `chamadudu/app/billingCycles/{cycleId}`, `chamadudu/app/billingEvents/{eventId}`, `chamadudu/app/depositos/{depositoId}`, `chamadudu/app/orders/{orderId}`, `chamadudu/app/job_locks/{lockId}` | Ciclo semanal deve migrar para `tenants/{tenantId}/products/dudu/billingCycles/...`. |
| `functions/src/robo/opsRobot.ts` | `roboDailyDepositoRollup`, `roboOpsGuard`, `roboPromoInteligente` | `chamadudu/app/depositos/{depositoId}`, `chamadudu/app/promo_history/{id}`, `chamadudu/app/issues/{issueId}`, `chamadudu/app/orders/{orderId}` | Promo inteligente precisa ser re-baselined no novo path. |
| `functions/src/core/issueService.ts` | `openIssueForOrder`, `resolveIssue` | `chamadudu/app/issues/{issueId}`, `chamadudu/app/orders/{orderId}`, `chamadudu/app/depositos/{depositoId}` | Issues devem ser re-escritas para `tenants/{tenantId}/products/dudu/issues/`. |
| `functions/src/core/rateLimitService.ts` | `rateLimitPerWa`, `rateLimitInbound` | `chamadudu/app/rate_limits/{waId}`, `chamadudu/app/userThrottle/{waId}` | Mover para `tenants/{tenantId}/products/dudu/rate_limits/`. |

O diretório `platform/channelDirectory/directory/{externalId}` é global (fora do namespace tenant). Cada doc guarda `externalId`, `tenantId`, `productId`, `channelType`, timestamps e resolve o tenant que deve responder para o WhatsApp `phone_number_id`.

> **Novo target de path V2**: cada registro acima deverá ser re-mapeado para `tenants/{tenantId}/products/dudu/<colecao>`, com batida de `tenantId` resolvido de `SINGLE_TENANT_CNPJ` ou `phoneNumberId`.

## 2. Export atual -> novo nome `dudu_<name>V1`

| Export atual (`functions/src/index.ts`) | Novo nome esperado | Comentário |
| --- | --- | --- |
| `whatsappWebhook` | `dudu_whatsappWebhookV1` | Webhook HTTP principal |
| `interWebhook` | `dudu_interWebhookV1` | Webhook Bancointer |
| `renderReceiptHtmlV1` | `dudu_renderReceiptV1` | Comprovante térmico |
| `depositoRegister` | `dudu_depositoRegisterV1` | Admin de depósitos |
| `billingGenerateWeekly` | `dudu_billingGenerateWeeklyV1` | Geração admin |
| `billingPublicCycle` | `dudu_billingPublicCycleV1` | Consulta pública |
| `billingWeeklyScheduler` | `dudu_billingWeeklySchedulerV1` | Scheduler semanal |
| `billingReconcileOpenCycles` | `dudu_billingReconcileOpenCyclesV1` | Scheduler reconcile |
| `roboDailyDepositoRollup` | `dudu_roboDailyDepositoRollupV1` | Robô estatísticas |
| `roboOpsGuard` | `dudu_roboOpsGuardV1` | Robô guardrails |
| `slaChecker3MinHttp` | `dudu_slaChecker3MinHttpV1` | Endpoint SLA |
| `slaChecker3Min` | `dudu_slaChecker3MinV1` | Scheduler SLA |

## 3. Secrets e env rebatizados para `KOSH_PROD_DUDU_*`

| Atual (secret/env) | Tipo | Novo nome | Onde lido hoje |
| --- | --- | --- | --- |
| `WHATSAPP_APP_SECRET` | Secret `defineSecret` | `KOSH_PROD_DUDU_WA_APP_SECRET` | `functions/src/config/secrets.ts` |
| `WHATSAPP_VERIFY_TOKEN` | Secret | `KOSH_PROD_DUDU_WA_VERIFY_TOKEN` | mesma pasta |
| `WHATSAPP_ACCESS_TOKEN` | Secret | `KOSH_PROD_DUDU_WA_TOKEN` | `functions/src/whatsapp/send.ts`, `index.ts` scheduler |
| `INTER_WEBHOOK_SECRET` | Secret | `KOSH_PROD_DUDU_INTER_WEBHOOK_SECRET` | `functions/src/config/secrets.ts`, `billing/interWebhook.ts` |
| `BILLING_ADMIN_KEY` | Secret | `KOSH_PROD_DUDU_BILLING_ADMIN_KEY` | `functions/src/billing/billing.ts` |
| `ROBO_ADMIN_TOKEN` | Secret | `KOSH_PROD_DUDU_ROBO_ADMIN_TOKEN` | `functions/src/config/secrets.ts` |
| `OPENAI_API_KEY` | Secret | `KOSH_PROD_DUDU_OPENAI_API_KEY` | `functions/src/config/secrets.ts` (promo) |
| `ADMIN_API_KEY` | Secret | `KOSH_PROD_DUDU_ADMIN_API_KEY` | `functions/src/config/secrets.ts` |
| `INTER_CLIENT_ID` | Secret | `KOSH_PROD_DUDU_INTER_CLIENT_ID` | `functions/src/billing/interClient.ts` |
| `INTER_CLIENT_SECRET` | Secret | `KOSH_PROD_DUDU_INTER_CLIENT_SECRET` | `.../interClient.ts` |
| `INTER_CERT_B64` | Secret | `KOSH_PROD_DUDU_INTER_CERT_B64` | `.../interClient.ts` |
| `INTER_KEY_B64` | Secret | `KOSH_PROD_DUDU_INTER_KEY_B64` | `.../interClient.ts` |
| `INTER_PIX_KEY` | Secret | `KOSH_PROD_DUDU_INTER_PIX_KEY` | `.../interClient.ts` |
| `SINGLE_TENANT_CNPJ` | Env | `KOSH_PROD_DUDU_SINGLE_TENANT_CNPJ` | `functions/src/config/chamaduduApp.ts` |
| `SINGLE_TENANT_KEY` | Env | `KOSH_PROD_DUDU_SINGLE_TENANT_KEY` | `functions/src/config/chamaduduApp.ts` |
| `INTER_BASE_URL` | Env | `KOSH_PROD_DUDU_INTER_BASE_URL` | `functions/src/billing/interClient.ts` |
| `INTER_OAUTH_PATH` | Env | `KOSH_PROD_DUDU_INTER_OAUTH_PATH` | `interClient.ts` |
| `INTER_PIX_BASE_PATH` | Env | `KOSH_PROD_DUDU_INTER_PIX_BASE_PATH` | `interClient.ts` |
| `INTER_BOLETO_BASE_PATH` | Env | `KOSH_PROD_DUDU_INTER_BOLETO_BASE_PATH` | `interClient.ts` |
| `BILLING_PAYMENT_BASE_URL` | Env | `KOSH_PROD_DUDU_BILLING_PAYMENT_BASE_URL` | `functions/src/billing/billing.ts` |
| `BILLING_PIX_EXPIRATION_SECONDS` | Env | `KOSH_PROD_DUDU_BILLING_PIX_EXPIRATION_SECONDS` | `functions/src/billing/billingService.ts` |
| `FEATURE_SLA_ENABLED` | Env | `KOSH_PROD_DUDU_FEATURE_SLA_ENABLED` | `functions/src/index.ts`, `sla/slaChecker.ts` |

## 4. Checklist de arquivos impactados no refactor

- `[ ] functions/src/index.ts` (expoe entrypoints + scheduler secrets)
- `[ ] functions/src/whatsapp/webhookHandler.ts` (dedupe + user/session)
- `[ ] functions/src/whatsapp/send.ts` (outbound + template handling)
- `[ ] functions/src/core/*.ts` (order, deposito, cliente, routing, issues, session, rateLimit)
- `[ ] functions/src/billing/*.ts` (cycle, reconcile, interWebhook, interClient)
- `[ ] functions/src/robo/opsRobot.ts` (promo, ops guard, rollup)
- `[ ] functions/src/sla/slaChecker.ts` (SLA scheduler + features)
- `[ ] FIRESTORE_INDEXES.md` e `firestore.indexes.json` (índices atualizados)
- `[ ] README.md`, `RUNBOOK.md`, `WORKLOG.md`, `CHANGELOG.md` (documentar nova estrutura)
- `[ ] MIGRATION_DUDU_BIGBANG.md` (este checklist)

## 5. Seed do channelDirectory (admin/script)

Use `functions/scripts/admin/seedChannelDirectory.ts` para criar/atualizar entry por `phone_number_id`.

- Projeto local/emulador (Firestore emulator): `FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx functions/scripts/admin/seedChannelDirectory.ts --phoneNumberId=<phone_number_id> --tenantId=<tenantId>`
- Produção (com GOOGLE_APPLICATION_CREDENTIALS): `npx tsx functions/scripts/admin/seedChannelDirectory.ts --phoneNumberId=<phone_number_id> --tenantId=<tenantId>`

Campos preenchidos: `externalId`, `tenantId`, `productId="dudu"`, `channelType="whatsapp"`, `createdAt`/`updatedAt`.

Depois do seed, o webhook usa `resolveTenantForWhatsAppPhoneNumberId` (`functions/src/core/channelDirectory.ts`) com cache TTL de 5 min, eliminando a dependência de `SINGLE_TENANT_*`.

> **Nota:** este inventário não altera comportamento; é um ponto de partida para refactor big-bang ao novo domínio `tenants/{tenantId}/products/dudu`.
