# Dev Mode Rotation Runbook

## Objetivo

Reduzir risco operacional do menu secreto `Dev mode` no WhatsApp com rotacao segura de token.

## Pre-requisitos

- Secrets configurados:
  - `DEV_TOKEN_CURRENT`
  - `DEV_TOKEN_PREVIOUS` (opcional)
  - `DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS` (epoch ms)
## Passo a passo de rotacao

1. Gerar novo token forte (>= 32 chars, aleatorio).
2. Copiar valor atual de `DEV_TOKEN_CURRENT` para `DEV_TOKEN_PREVIOUS`.
3. Definir `DEV_TOKEN_CURRENT` com o novo token.
4. Definir `DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS` com janela curta (ex.: agora + 24h).
5. Deploy/reload das Functions.
6. Verificar autenticacao com token novo e token anterior.
7. Apos a janela:
   - limpar `DEV_TOKEN_PREVIOUS`
   - setar `DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS=0`
8. Revalidar autenticao (token antigo deve falhar).

## Verificacao operacional

- Endpoint admin:
  - `GET /api/admin/dev-mode/audit?tenantId=<tenantId>&limit=20`
- Conferir:
  - `locks` ativos
  - `recentEvents` (`auth_success`, `auth_invalid_password`, `command`, `command_failed`)

## Resposta a incidente

- Ataque por tentativa de senha:
  - rotacionar `DEV_TOKEN_CURRENT` imediatamente
  - revisar `recentEvents` no endpoint de auditoria
- Uso indevido por qualquer numero:
  - rotacionar token
  - revisar trilha em `audits` (`kind=dev_mode_event`)
