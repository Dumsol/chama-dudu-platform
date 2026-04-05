# Release Gates

## Objetivo

Falhar cedo para regressao de tenant-scope, paths legados e cobertura critica.

## Integracao de pipeline (versionada no repo)

Workflows GitHub Actions:

- `.github/workflows/gate-pr.yml`
- `.github/workflows/gate-merge.yml`
- `.github/workflows/deploy-functions-prod.yml`

Credenciais exigidas no repositório:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`

## Gates por etapa

### PR

Executar:

```bash
cd functions
npm run gate:pr
```

Inclui:

- `lint` (inclui `gate:no-legacy`)
- `typecheck`
- `test`

### Merge (branch principal)

Executar:

```bash
cd functions
npm run gate:merge
```

Inclui:

- tudo do PR
- `build`

### Deploy

Executar:

```bash
cd functions
PROJECT_ID=<projeto> ROLLOUT_REQUIRED_TENANTS=<tenant1,tenant2> npm run go-live:check
PROJECT_ID=<projeto> AUTH_MODE=gcloud ROLLOUT_REQUIRED_TENANTS=<tenant1,tenant2> npm run gate:deploy
```

Inclui:

- gate de merge
- `gate:rollout-config` (valida `features.matching.rollout` para tenants obrigatorios)
- `audit:legacy-root:strict`
- precheck de configuracao (`go-live:check`) para envs/secrets operacionais criticos

Se `gate:deploy` falhar, o deploy deve ser bloqueado.

No workflow de deploy, o job `deploy` depende de `gate-deploy`. Se `gate:deploy` falhar, o deploy nao inicia.

### Diario (operacao)

- `dudu_legacyRootAuditMonitorDailyV1` (scheduler) roda snapshot/comparacao/alerta
- opcionalmente executar script estrito:

```bash
cd functions
PROJECT_ID=<projeto> AUTH_MODE=gcloud npm run gate:daily
```

## Regras de bloqueio

- qualquer doc em root collection proibida bloqueia `audit:legacy-root:strict`
- tenant obrigatorio sem `features.matching.rollout` bloqueia `gate:rollout-config`
- uso textual proibido de `.collection("...")` em modulos guardados bloqueia `gate:no-legacy`
- falha de `typecheck`, `test` ou `build` bloqueia release

## Mapa final do que roda

- PR: `gate:pr`
- Merge para main/master: `gate:merge`
- Deploy manual de producao: `gate:deploy` + deploy Functions + verificacao de runtime `nodejs22` + strict audit pos-deploy
- Diario: scheduler `dudu_legacyRootAuditMonitorDailyV1`
