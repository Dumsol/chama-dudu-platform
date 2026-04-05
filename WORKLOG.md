# WORKLOG

- `2026-01-10T00:55Z` Repo hygiene: moved docs into `/docs` (+ `docs/archive`), promoted `WORKLOG.md` to root, rewrote README, removed logs/build artifacts, consolidated schedules into `dudu_cronRunnerV1`, added job lock helper, and added env-first secret resolution for non-critical secrets.
- `2026-01-10T01:10Z` Ran `cmd /c "npm --prefix functions ci"` and `cmd /c "npm --prefix functions run build -- --pretty false"` (tsc OK). Removed `functions/node_modules` and `functions/lib` after verification.
- `2026-01-10T02:20Z` Implemented Promo Inteligente MVP: promo module with budget/ledger/raspadinha guardrails, tenant feature flags + admin endpoint with audits, WhatsApp opt-in/out/status flows, order delivered hook + service fee waiver apply, daily sweep in cron runner, tests and docs updates.
- `2026-01-04T18:40Z` – Added README note about billing Q1 totals and trimmed duplicate text; created `MIGRATION_DUDU_BIGBANG.md` with Firestore/export/secret inventories, no behavior change.
- `2026-01-04T18:46Z` – Ran `cmd /c "npm --prefix functions run build -- --pretty false"` (tsc) after fixing implicit-any in `billingService.ts`; passed.
- `2026-01-04T18:48Z` – Ran `cmd /c "npm --prefix functions run test:billing-q1"`; billing Q1 tests pass.
- `2026-01-04T19:32Z` – Added `channelDirectory` resolver + admin seeder script, rewired `whatsappWebhookHandler` to the directory (removing single-tenant dependency), documented usage in `MIGRATION_DUDU_BIGBANG.md`, and reran `cmd /c "npm --prefix functions run build -- --pretty false"` (tsc).
- `2026-01-04T20:12Z` – Added `functions/src/core/duduPaths.ts`, updated `chamaduduApp.ts` to use the new V2 base, updated docs (README + MIGRATION), and ran `cmd /c "npm --prefix functions run build -- --pretty false"` (tsc).
- `2026-01-04T21:05Z` – Refactored `functions/src/whatsapp/webhookHandler.ts` to resolve tenant via channelDirectory, routed inbound/outbound writes to V2 paths, added structured logs, and added `functions/scripts/dev/smokeWebhookV2.ts`; ran `cmd /c "npm --prefix functions run build -- --pretty false"` (tsc).
- `2026-01-04T21:18Z` – Added tenant/phone_number_id/wa_id context for webhook error logs and reran `cmd /c "npm --prefix functions run build -- --pretty false"` (tsc).
- 2026-01-04T21:36Z Updated irestore.rules to deny-all baseline with optional platformAdmin read and documented Admin SDK bypass.
- 2026-01-04T21:38Z Fixed whatsappVerifyToken reference to waVerifyToken in unctions/src/whatsapp/webhookHandler.ts (verify webhook token check).
- `2026-01-05T15:20Z` Implemented anti-merda harness (webhook hardening, diag endpoint, kill-switch stats, tools), added `.secret.local`, updated README/scripts, and ran: `cmd /c "npm --prefix functions run build"` (tsc OK), `cmd /c "npm --prefix functions run gate:no-legacy"` (PASS), `cmd /c "firebase emulators:exec --project kosh-tecnology --only firestore,functions ""npm --prefix functions run smoke:anti-merda"""` (PASS).
- `2026-01-05T15:12Z` Smoke exec falhou (secret manager 403 + latencia >800ms + sendDisabledHits=0); ajustado com `.secret.local`, fallback diag via Firestore e medicao de latencia no POST idempotente.
- `2026-01-05T16:52Z` Rodado `cmd /c "npm --prefix functions run build"` (tsc OK) e `cmd /c "npm --prefix functions run gate:no-legacy"` (PASS).
- `2026-01-05T16:54Z` Rodado emuladores com `firebase.cmd emulators:exec --project kosh-tecnology --only firestore,functions -- "npm --prefix functions run smoke:anti-merda"` usando envs de smoke (verify/app secret, token, WHATSAPP_DISABLE_SEND, FUNCTIONS_EMULATOR); smoke PASS.
- `2026-01-05T17:06Z` Adicionado `.secret.local` ao `.gitignore`, criado `/.secret.local.example` e atualizado README com nota do exemplo.
