# Production Readiness

## Secrets (Firebase Functions v2)
- WHATSAPP_ACCESS_TOKEN (WhatsApp Cloud API token via secret)
- WHATSAPP_APP_SECRET (WhatsApp app secret for webhook validation)
- WHATSAPP_VERIFY_TOKEN (WhatsApp webhook verify token)
- GOOGLE_MAPS_API_KEY (geocoding/fallback)
- INTER_WEBHOOK_SECRET (Pix webhook authentication)
- BILLING_ADMIN_KEY (billing scheduler and manual invoices)
- ADMIN_API_TOKEN or ROBO_ADMIN_TOKEN (ops/admin shortcuts)
- OPENAI_API_KEY (optional fallback responses)

## Environment Variables & Feature Flags
- SINGLE_TENANT_CNPJ / SINGLE_TENANT_KEY (tenant isolation)
- WHATSAPP_HTTP_* timeout/backoff knobs
- BOT_MAX_CONSECUTIVE (anti-loop limit)
- STICKER_COOLDOWN_MS, PROMO windows, BOT tone markers
- FEATURE_BOT_GUARD_ENABLED, FEATURE_WHATSAPP_SEND_DISABLED, FEATURE_EXTERNAL_CALLS_DISABLED
- FEATURE_EVENTLOG_ENABLED, FEATURE_STICKERS_ENABLED
- BILLING_PAYMENT_BASE_URL, BILLING_PIX_EXPIRATION_SECONDS, TX_MAX_RETRIES

## Preconditions
1. Secrets must be configured in Firebase Functions params; do not edit .env files.
2. Dev-only flags and bypass helpers must be removed from runtime code.
3. Feature flags gate guardrails; keep defaults safe for production.

## Deploy Checklist
- npm --prefix functions run build (tsc)
- npm --prefix functions run lint (if available)
- Confirm new billing snapshot event (CLIENT_BILLING_SNAPSHOT) is present
- Run ripgrep for banned dev-only flags/bypass helpers in functions/src
- Validate billing endpoints (billingGenerateWeekly, reconcileOpenCycles, interWebhook) still respond correctly

## Local Validation
1. npm --prefix functions run build
2. (optional) npm --prefix functions run lint or npm --prefix functions run test
3. Run ripgrep for banned dev-only flags/bypass helpers in functions/src

## Guardrails & Notes
- Billing snapshots (GMV, service fee, totals) are logged when the client confirms value or delivery.
- markPaidByInterPixEvent now ensures idempotent cycle updates before releasing deposits.
- outbox writes remain best-effort and respect WHATSAPP_SEND_DISABLED / FEATURE_EXTERNAL_CALLS_DISABLED.
- Never rename, copy, or commit .env files; rely on safe defaults or guardrails instead.
