# Backend Tenant-Scoped e Heurística Conversacional

## Regra de persistência

Metadata de tenant pode existir em `tenants/{tenantId}`.

Todo dado operacional do produto deve existir em subcoleções de:

- `tenants/{tenantId}/products/dudu/...`

Se um novo write ou read de negócio for criado fora desse escopo, isso é bug.

## Coleções operacionais autorizadas

- `tenants/{tenantId}/products/dudu/users/{userId}`
- `tenants/{tenantId}/products/dudu/depositos/{depositoId}`
- `tenants/{tenantId}/products/dudu/depositosByWa/{waId}`
- `tenants/{tenantId}/products/dudu/orders/{orderId}`
- `tenants/{tenantId}/products/dudu/orders_done/{orderId}`
- `tenants/{tenantId}/products/dudu/orders_public/{publicCode}`
- `tenants/{tenantId}/products/dudu/mensagens/{messageId}`
- `tenants/{tenantId}/products/dudu/processedMessages/{messageId}`
- `tenants/{tenantId}/products/dudu/preCadastros/{preCadastroId}`
- `tenants/{tenantId}/products/dudu/conversas/{conversationId}`
- `tenants/{tenantId}/products/dudu/routing_state/{stateId}`
- `tenants/{tenantId}/products/dudu/rate_limits/{rateKey}`
- `tenants/{tenantId}/products/dudu/printQueue/{orderId}`
- `tenants/{tenantId}/products/dudu/issues/{issueId}`
- `tenants/{tenantId}/products/dudu/billingCycles/{cycleId}`
- `tenants/{tenantId}/products/dudu/billingEvents/{eventId}`
- `tenants/{tenantId}/products/dudu/job_locks/{lockId}`
- `tenants/{tenantId}/products/dudu/wa_dedupe/{messageId}`
- `tenants/{tenantId}/products/dudu/inboundProcessed/{messageId}`
- `tenants/{tenantId}/products/dudu/outboundMessages/{traceId}`
- `tenants/{tenantId}/products/dudu/outbox/{outboxId}`

## Exceções globais justificadas

Permanece global apenas o que é realmente plataforma:

- `tenants/{tenantId}`: metadata do tenant
- `platform/channelDirectory/directory/{phoneNumberId}`: resolução de tenant por canal WhatsApp
- `platform/diag/runtime/sendDisabled`: chave global de diagnóstico e circuit breaker de envio

Essas exceções não guardam estado operacional de cliente, depósito, pedido ou conversa.

## Paths centralizados

O ponto central é `functions/src/infra/firestore/duduPaths.ts`.

Builders principais:

- `tenantDoc(tenantId)`
- `productDoc(tenantId)`
- `usersCol(tenantId)`
- `depositosCol(tenantId)`
- `ordersCol(tenantId)`
- `messagesCol(tenantId)`
- `processedMessagesCol(tenantId)`
- `preCadastrosCol(tenantId)`
- `conversationsCol(tenantId)`
- `rateLimitsCol(tenantId)`
- `printQueueCol(tenantId)`

Regras:

- `tenantId` é obrigatório
- `assertTenantId` deve falhar cedo quando o escopo vier vazio
- código novo não deve usar `db.collection("users")`, `db.collection("depositos")`, `db.collection("mensagens")` e equivalentes

## Regressão proibida

O gate `npm run gate:no-legacy` verifica uso proibido de coleções raiz legadas.

Arquivo:

- `functions/src/tools/noLegacyPathsCheck.ts`

O gate falha se detectar:

- `db.collection("users")`
- `db.collection("depositos")`
- `db.collection("mensagens")`
- `db.collection("processedMessages")`
- `db.collection("precadastros")`
- `db.collection("rateLimits")`
- `db.collection("printQueue")`

Esse gate roda dentro de `npm run lint`.

Guarda estrutural adicional:

- os módulos abaixo não podem usar `.collection("...")` textual
- eles devem usar builders de `duduPaths` (ou helpers centralizados equivalentes)

Arquivos protegidos:

- `functions/src/modules/billing/billingService.ts`
- `functions/src/modules/depositos/depositoService.ts`
- `functions/src/modules/orders/orderService.ts`
- `functions/src/modules/orders/orderRoutingService.ts`
- `functions/src/modules/issues/issueService.ts`
- `functions/src/jobs/opsRobot.ts`

## Migração e saneamento do legado

Script:

- `functions/src/tools/migrateLegacyRootCollections.ts`
- `functions/src/tools/auditLegacyRootCollections.ts`

Objetivo:

- ler documentos antigos em coleções raiz conhecidas
- exigir `tenantId` no documento
- gravar no path tenant-scoped correspondente
- permitir dry-run
- ser idempotente

Uso:

```bash
cd functions
npm run audit:legacy-root
npm run audit:legacy-root:strict

# preview (nao altera dados)
set DRY_RUN=true && npx tsx src/tools/migrateLegacyRootCollections.ts

# aplica migracao segura
set DRY_RUN=false && npx tsx src/tools/migrateLegacyRootCollections.ts
```

Variaveis importantes:

- `FAIL_IF_FOUND=true` no `auditLegacyRootCollections` para falhar em CI quando houver residuos
- `REPORT_JSON_PATH=./legacy-audit.json` para exportar JSON do relatorio
- `REPORT_MD_PATH=./legacy-audit.md` para exportar relatorio legivel
- `AUTH_MODE=auto|admin|gcloud`
  - `auto`: tenta Admin SDK e fallback para token do `gcloud`
  - `admin`: exige ADC/service-account valida
  - `gcloud`: usa `gcloud auth print-access-token`
- `PROJECT_ID=<id>` para direcionar ambiente (prod/staging) explicitamente
- `FORCE_OVERWRITE=false` por default para evitar sobrescrita cega
- `DELETE_SOURCE_AFTER_MIGRATION=false` por default para saneamento conservador

Runbook operacional rapido:

```bash
# local sem ADC
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud npm run audit:legacy-root
PROJECT_ID=your-project-id AUTH_MODE=gcloud DRY_RUN=true npm run migrate:legacy-root

# cloud shell/CI com ADC
PROJECT_ID=your-project-id AUTH_MODE=admin npm run audit:legacy-root:strict
```

Monitoramento de regressao em runtime:

- agendar `npm run audit:legacy-root:strict` periodicamente
- classificar resultados por colecao: `vazio`, `residuo_historico_migravel`, `residuo_historico_orfao`, `suspeita_write_ativo_indevido`
- investigar imediatamente qualquer `suspeita_write_ativo_indevido`
- function automatica: `dudu_legacyRootAuditMonitorDailyV1`
  - executa diariamente (schedule configuravel por `LEGACY_AUDIT_SCHEDULE`)
  - persiste snapshots em `platform/opsLegacyRootAudit/projects/{projectId}`
  - compara com snapshot anterior e marca:
    - `sem_mudanca`
    - `novo_residuo`
    - `crescimento_suspeito`
    - `limpeza_concluida`
  - status operacional por colecao:
    - `OK`
    - `residuo_historico_estavel`
    - `suspeita_write_ativo`
  - gera `alerts/{runId}` e log `LEGACY_ROOT_AUDIT_ALERT` quando houver suspeita

## Resolução de tenant no webhook

O pipeline resolve `tenantId` no início do processamento.

Fontes:

- mapeamento em `platform/channelDirectory/directory/{phoneNumberId}`
- fallback controlado por `WHATSAPP_SYSTEM_PHONE_NUMBER_IDS`

Depois da resolução:

- dedupe fica tenant-scoped
- rate limit fica tenant-scoped
- persistência de usuário, depósito, conversa e mensagem fica tenant-scoped

## Heurística de intenção

Pipeline:

1. normalização de texto
2. extração de entidades
3. classificação heurística de intenção
4. detector de meta-intenção antes de continuar o fluxo atual

Sinais cobertos:

- continuação normal
- cancelamento explícito
- saída indireta
- saudação em fluxo ativo
- ajuda e menu
- reclamação, confusão, frustração
- pedido de humano
- dúvida de horário
- dúvida de entrega
- dúvida de produtos
- pergunta ambígua no meio do fluxo

## Interrupção, cancelamento e desambiguação

Quando o usuário muda de assunto no meio do pedido:

- o detector de meta-intenção intercepta a mensagem antes da continuação do estado
- o estado anterior pode ser interrompido ou cancelado
- o bot responde ao novo assunto ou pede uma desambiguação curta

Exemplos tratados:

- `deixa isso`
- `esquece`
- `quanto custa a entrega?`
- `qual o horario?`
- `tem agua com gas?`
- `oi`
- `me ajuda`
- `nao era isso`

Quando a mensagem é ambígua em fluxo ativo:

- o usuário vai para `awaiting_disambiguation`
- o bot pergunta se deve continuar o pedido ou falar de outra coisa

## TTL de estado

O estado conversacional não pode sequestrar mensagens novas indefinidamente.

Mecanismo atual:

- `botStateExpiresAtMs`
- reset automático quando o estado expira
- limpeza de `pendingBotState` e `stateHint` em reset/cancelamento

## Como validar localmente

```bash
cd functions
npm run lint
npm run typecheck
npm run test
npm run build
```

Runbook operacional detalhado:

- `docs/operacao-legacy-root-audit.md`

## Limpeza segura de residuo redundante

Quando o documento raiz ja possui equivalente tenant-scoped valido:

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud DRY_RUN=false DELETE_SOURCE_AFTER_MIGRATION=true DELETE_SOURCE_IF_TARGET_EXISTS=true npm run migrate:legacy-root
```

Regras:

- manter `FORCE_OVERWRITE=false`
- executar auditoria antes e depois
- nao apagar se nao houver destino tenant-scoped existente
