# Runbook: Auditoria Legacy Root Collections

## Objetivo

Detectar regressao de persistencia fora do escopo tenant e manter saneamento seguro de residuos historicos.

Colecoes raiz auditadas:

- `users`
- `depositos`
- `mensagens`
- `processedMessages`
- `precadastros`
- `rateLimits`
- `printQueue`

## Modos de execucao manual

### 1) Auditoria operacional (relatorio)

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud REPORT_JSON_PATH=../docs/ops-audit.json REPORT_MD_PATH=../docs/ops-audit.md npm run audit:legacy-root
```

### 2) Auditoria estrita (falha se houver residuos)

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud npm run audit:legacy-root:strict
```

### 3) Monitor com snapshot/comparacao

```bash
cd functions
npm run audit:legacy-root:monitor
```

Observacao:

- Esse script usa Admin SDK (ADC/service account).
- Sem ADC local, use disparo manual do scheduler no GCP:

```bash
gcloud scheduler jobs run firebase-schedule-dudu_legacyRootAuditMonitorDailyV1-southamerica-east1 --location southamerica-east1 --project your-project-id
```

## Automacao ativa

Function agendada:

- `dudu_legacyRootAuditMonitorDailyV1`
- Schedule default: `every day 06:40` (`America/Sao_Paulo`)

Snapshot salvo em:

- `platform/opsLegacyRootAudit/projects/{projectId}`
- `.../runs/{runId}`
- `.../alerts/{runId}` (apenas quando status = `ALERT`)

## Interpretacao de status

Status por colecao:

- `OK`: sem doc em raiz proibida (ou limpeza concluida)
- `residuo_historico_estavel`: sem crescimento suspeito, resíduo conhecido/estavel
- `suspeita_write_ativo`: novo residuo ou crescimento suspeito

Comparacao com snapshot anterior:

- `sem_mudanca`
- `novo_residuo`
- `crescimento_suspeito`
- `limpeza_concluida`

## Saneamento seguro

### Dry-run

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud DRY_RUN=true npm run migrate:legacy-root
```

### Aplicacao conservadora (sem overwrite)

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud DRY_RUN=false FORCE_OVERWRITE=false DELETE_SOURCE_AFTER_MIGRATION=false npm run migrate:legacy-root
```

### Limpeza de origem redundante (destino ja existe)

```bash
cd functions
PROJECT_ID=your-project-id AUTH_MODE=gcloud DRY_RUN=false FORCE_OVERWRITE=false DELETE_SOURCE_AFTER_MIGRATION=true DELETE_SOURCE_IF_TARGET_EXISTS=true npm run migrate:legacy-root
```

Regras:

- nunca usar `FORCE_OVERWRITE=true` sem analise manual
- confirmar equivalente tenant-scoped antes de deletar origem
- reauditar depois da limpeza

## Resposta a incidente

Se `audit:legacy-root:strict` falhar apos deploy:

1. executar auditoria com `REPORT_JSON_PATH` e `REPORT_MD_PATH`
2. classificar se e residuo antigo ou crescimento novo
3. rodar dry-run de migracao e avaliar orfaos
4. se houver write ativo, tratar como P0:
   - identificar origem
   - corrigir e deploy direcionado
   - limpar origem redundante
   - reauditar apos 1 ciclo do scheduler

## Correlacao com revisao/deploy/logs/scheduler

Checar revisao ativa da function suspeita:

```bash
gcloud functions describe <functionName> --gen2 --region=southamerica-east1 --project=<projectId> --format="value(updateTime,serviceConfig.revision)"
```

Checar estado do scheduler:

```bash
gcloud scheduler jobs describe <jobName> --location=southamerica-east1 --project=<projectId> --format=json
```

Disparo manual para reproduzir/validar:

```bash
gcloud scheduler jobs run <jobName> --location=southamerica-east1 --project=<projectId>
```

Consultar snapshot mais recente:

- `platform/opsLegacyRootAudit/projects/{projectId}.latestSnapshot`
- `latestRunId`, `lastStatus` e `lastAlertCollections`

## Autenticacao recomendada

Opcao 1 (runtime GCP / scheduler): ADC nativo da service account da function.

Opcao 2 (CI/Cloud Shell/local):

- `AUTH_MODE=admin` com `GOOGLE_APPLICATION_CREDENTIALS`
- ou `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SERVICE_ACCOUNT_JSON`

Opcao 3 (operacao manual local): `AUTH_MODE=gcloud`.
