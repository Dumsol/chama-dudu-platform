# Inventario Firestore Textual (Repo-wide)

Data da varredura: 2026-03-14.

Escopo: `functions/src/**/*.ts` procurando `.collection("...")`.

## 1) Permitida (camada central/autorizada)

- `functions/src/infra/firestore/duduPaths.ts`
  - camada oficial de paths e colecoes.
- `functions/src/infra/firestore/channelDirectory.ts`
  - usa builder central (`channelDirectoryCol`), sem nomes de colecao de negocio.

## 2) Permitida (global/plataforma, fora de negocio tenant)

- `functions/src/app/http/diag.ts`
  - `platform/diag/runtime`.
- `functions/src/modules/whatsapp/send.ts`
  - leitura de runtime global `platform/diag/runtime`.
- `functions/src/jobs/legacyRootAuditMonitor.ts`
  - snapshot/alerta em `platform/opsLegacyRootAudit/...` via builders.

## 3) Divida estrutural segura (ferramentas/smoke)

- `functions/src/tools/antiMerdaSmoke.ts`
- `functions/src/tools/smokeOpsV1.ts`

Motivo: scripts de smoke e validacao local; nao compoem fluxo de negocio de producao.

## 4) Risco de regressao (negocio fora camada aprovada)

Status atual: **nenhuma ocorrencia ativa encontrada** nos modulos de negocio guardados.

Arquivos guardados por gate (proibido `.collection("...")` textual):

- `modules/billing/billingService.ts`
- `modules/depositos/depositoService.ts`
- `modules/orders/orderService.ts`
- `modules/orders/orderRoutingService.ts`
- `modules/issues/issueService.ts`
- `modules/common/messageService.ts`
- `modules/users/sessionService.ts`
- `modules/promo/promoInteligente.ts`
- `modules/ops/fallbackRouter.ts`
- `modules/whatsapp/antiRepeat.ts`
- `modules/whatsapp/clienteHandler.ts`
- `infra/jobs/jobLock.ts`
- `infra/obs/eventLogService.ts`
- `jobs/opsRobot.ts`
- `jobs/legacyRootAuditMonitor.ts`

## Resultado

- Superficie de erro humano reduzida: paths de negocio concentrados em `duduPaths`.
- Gate `noLegacyPathsCheck` reforcado para bloquear regressao de colecoes textuais em modulos criticos.
