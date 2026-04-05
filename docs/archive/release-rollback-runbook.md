# Runbook de Release e Rollback (Dudu)

## 1) Checklist pre-deploy

1. Confirmar projeto alvo (`your-project-id` para producao).
2. Confirmar branch/tag correta.
3. Executar gates:

```bash
cd functions
npm ci
PROJECT_ID=your-project-id ROLLOUT_REQUIRED_TENANTS=<tenant1,tenant2> npm run go-live:check
PROJECT_ID=your-project-id AUTH_MODE=gcloud npm run gate:deploy
```

4. Confirmar root collections proibidas zeradas no strict audit.

## 2) Sequencia de release

1. Bootstrap de rollout por tenant (uma vez):
   - `POST /api/admin/matching/rollout/bootstrap`
2. Ativar canario 10% por bairro piloto:
   - `POST /api/admin/matching/rollout/set` com `enabled=true`, `defaultPercent=0`, `bairrosPatch.<bairro>.percent=10`
3. Canary (recomendado): deploy de uma function de baixo risco.
4. Deploy controlado somente `dudu_*`:

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --project your-project-id --only \
functions:dudu_whatsappWebhookV1,functions:dudu_diagHttpV1,functions:dudu_interWebhookV1,functions:dudu_renderReceiptHtmlV1,functions:dudu_depositoRegisterV1,functions:dudu_slaChecker3MinHttpV1,functions:dudu_promoAdminToggleV1,functions:dudu_opsAppV1,functions:dudu_billingGenerateWeeklyV1,functions:dudu_billingPublicCycleV1,functions:dudu_cronRunnerV1,functions:dudu_seedTestDepositoV1,functions:dudu_legacyRootAuditMonitorDailyV1
```

## 3) Validacao pos-deploy

1. Runtime:

```bash
gcloud functions list --v2 --project your-project-id --format="table(name,buildConfig.runtime,state,updateTime)"
```

Esperado: `dudu_*` em `nodejs22` e `ACTIVE`.

2. Strict audit:

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud npm run audit:legacy-root:strict
```

3. Scheduler smoke:

```bash
gcloud scheduler jobs run firebase-schedule-dudu_legacyRootAuditMonitorDailyV1-southamerica-east1 --location southamerica-east1 --project your-project-id
gcloud scheduler jobs run firebase-schedule-dudu_seedTestDepositoV1-southamerica-east1 --location southamerica-east1 --project your-project-id
```

4. Endpoint smoke:
- `dudu_opsAppV1 /api/health` deve responder `200`.
- `dudu_whatsappWebhookV1` sem assinatura valida deve responder `401` (assinatura rejeitada).
5. Smoke funcional:
   - 1 pedido cliente com matching (bairro piloto)
   - 1 operacao deposito (`abrir/fechar/status`)
   - `dev mode` com token valido + lock por tentativas invalidas

## 4) Monitor diario e alerta

- Job: `firebase-schedule-dudu_legacyRootAuditMonitorDailyV1-southamerica-east1`
- Se houver alerta (`LEGACY_ROOT_AUDIT_ALERT`):
1. Rodar strict audit manual.
2. Classificar se e resíduo historico ou write ativo.
3. Se write ativo, tratar como P0 e bloquear novos deploys.

## 5) Se strict audit falhar no deploy

1. Nao prosseguir deploy.
2. Rodar auditoria detalhada:

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud REPORT_JSON_PATH=./legacy-audit.json npm run audit:legacy-root
```

3. Executar apenas `DRY_RUN` de saneamento:

```bash
DRY_RUN=true PROJECT_ID=your-project-id AUTH_MODE=gcloud npm run migrate:legacy-root
```

## 6) Rollback

### Rollback rapido de revisao (Cloud Run underlying service)

1. Listar revisoes do servico:

```bash
gcloud run revisions list --region southamerica-east1 --project your-project-id --service dudu-whatsappwebhookv1
```

2. Direcionar trafego para revisao anterior estavel:

```bash
gcloud run services update-traffic dudu-whatsappwebhookv1 --region southamerica-east1 --project your-project-id --to-revisions <REVISAO_ESTAVEL>=100
```

Repita para servicos criticos se necessario (`dudu-cronrunnerv1`, `dudu-opsappv1`).

### Rollback de codigo

1. Reverter commit no branch de release.
2. Rodar `gate:deploy`.
3. Redeploy controlado `dudu_*`.

## 7) Incidentes comuns pos-upgrade

- Webhook falhando:
1. Validar secrets (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`).
2. Validar assinatura (`401` esperado sem assinatura, `200` com assinatura valida).
3. Checar logs `dudu-whatsappwebhookv1`.

- Scheduler falhando:
1. Verificar `gcloud scheduler jobs list`.
2. Rodar `gcloud scheduler jobs run ...` manual.
3. Checar logs dos servicos alvo.

- Reapareceu root collection proibida:
1. Tratar como regressao P0.
2. Congelar release ate identificar origem.
3. Corrigir origem + teste de regressao + rerodar gates.
