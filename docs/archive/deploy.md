# deploy

## Pre-requisitos
- Node 22 (Functions v2).
- Firebase CLI autenticado.
- Secrets configurados no projeto (ou env vars, quando aplicavel).
- Para CI/CD por GitHub Actions:
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - `GCP_SERVICE_ACCOUNT_EMAIL`

## Build e validacao local
1. `npm --prefix functions run build`
2. (opcional) `npm --prefix functions run typecheck`
3. (opcional) `npm --prefix functions run test:validators` e outros testes
4. (opcional) `firebase emulators:exec --only firestore,functions --project <id> "npm --prefix functions run smoke"`

## Deploy
- Evitar deploy global quando o projeto possui outras functions fora deste source (ex.: `opemly_*`).
- Usar deploy filtrado das functions Dudu:

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --project your-project-id --only \
functions:dudu_whatsappWebhookV1,functions:dudu_diagHttpV1,functions:dudu_interWebhookV1,functions:dudu_renderReceiptHtmlV1,functions:dudu_depositoRegisterV1,functions:dudu_slaChecker3MinHttpV1,functions:dudu_promoAdminToggleV1,functions:dudu_billingGenerateWeeklyV1,functions:dudu_billingPublicCycleV1,functions:dudu_cronRunnerV1,functions:dudu_legacyRootAuditMonitorDailyV1
```

Pos-deploy obrigatorio:

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud npm run audit:legacy-root:strict
```

## Cron runner
- `dudu_cronRunnerV1` consolida todos os schedules.
- Se precisar pausar agendamentos sem remover o deploy: `FEATURE_CRON_RUNNER_ENABLED=false`.

## Secrets e env
- Secrets (prod): `KOSH_PROD_DUDU_*` via Secret Manager.
- Env vars opcionais: set `SECRETS_ENV_FIRST=true` para usar `process.env` quando presente.
- Nunca commit segredos; use `.secret.local` localmente.

## Pre-cadastro de deposito (operacional)
Template inicial de confirmacao:
- `WA_TEMPLATE_DEPOSITO_PRE_CADASTRO_CONFIRMACAO=<nome_template_aprovado_meta>`
- `WA_TEMPLATE_DEPOSITO_PRE_CADASTRO_LANG=pt_BR`
- Categoria esperada no WhatsApp Manager: `UTILITY`

Fallback e timeout:
- `WA_TEMPLATE_PRE_CADASTRO_ALLOW_TEXT_FALLBACK=true|false`
- `PRE_CADASTRO_ABANDON_AFTER_HOURS=72`

Fila operacional:
- Operacoes de admin centralizadas em `dudu_adminOpsV1` e `dudu_diagHttpV1`.
- Retorno inclui agregados por status, confirmationStep e listas resumidas para correcao manual.


Troubleshooting rapido:
1. `failed_delivery` crescente: validar nome/idioma do template e se o template esta aprovado para o WABA.
2. `manual_review` > 0: revisar `confirmationStep` inconsistente e retomar manualmente no WhatsApp.
3. `awaiting_location` alto: operação deve acionar deposito e orientar envio da localizacao oficial.
