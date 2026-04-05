# Modernizacao Controlada de Runtime e Dependencias

## Status atual (2026-03-14)

- `functions/package.json` usa `engines.node = "22"`.
- Dependencias atualizadas:
  - `firebase-functions` `^7.1.1`
  - `firebase-admin` `^13.7.0`
  - `openai` `^6.29.0`
  - `undici` `^6.24.0`
- Todas as functions `dudu_*` em producao (`your-project-id`) estao em `nodejs22`.

## Evidencia de rollout

Comando de verificacao:

```bash
gcloud functions list --v2 --project your-project-id --format="table(name,buildConfig.runtime,state,updateTime)"
```

Resultado relevante: todas `dudu_*` com `RUNTIME=nodejs22` e `STATE=ACTIVE`.

## Procedimento usado no rollout

1. Canary:

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --project your-project-id --only functions:dudu_diagHttpV1
```

2. Rollout controlado (somente escopo Dudu, para nao tocar `opemly_*`):

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --project your-project-id --only \
functions:dudu_whatsappWebhookV1,functions:dudu_diagHttpV1,functions:dudu_interWebhookV1,functions:dudu_renderReceiptHtmlV1,functions:dudu_depositoRegisterV1,functions:dudu_slaChecker3MinHttpV1,functions:dudu_promoAdminToggleV1,functions:dudu_opsAppV1,functions:dudu_billingGenerateWeeklyV1,functions:dudu_billingPublicCycleV1,functions:dudu_cronRunnerV1,functions:dudu_seedTestDepositoV1,functions:dudu_legacyRootAuditMonitorDailyV1
```

3. Validacao pos-deploy:

- strict audit:

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud npm run audit:legacy-root:strict
```

- scheduler smoke:

```bash
gcloud scheduler jobs run firebase-schedule-dudu_legacyRootAuditMonitorDailyV1-southamerica-east1 --location southamerica-east1 --project your-project-id
gcloud scheduler jobs run firebase-schedule-dudu_seedTestDepositoV1-southamerica-east1 --location southamerica-east1 --project your-project-id
```

## Observacoes operacionais

- O projeto possui functions `opemly_*` fora deste source; por isso deploy de producao deve filtrar apenas `dudu_*`.
- Para evitar timeout de discovery na CLI, manter `FUNCTIONS_DISCOVERY_TIMEOUT=120` no deploy.
