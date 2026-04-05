# custos

## Principais custos
- Cloud Functions: invocacoes do webhook e do cron runner.
- Firestore: reads/writes de orders, depositos, issues, billingCycles, logs.
- Secret Manager: acesso a secrets por funcao.
- APIs externas: WhatsApp, Banco Inter, OpenAI (quando habilitado).
- Promo Inteligente: writes no ledger e reads de promo/dep.

## Como reduzir
- Mantem o cron runner unico (`dudu_cronRunnerV1`) e evita novos schedules.
- Feature flags por tenant permitem desligar promo/raspadinha/GPT sem redeploy.
- Use limites nas queries e evite scans sem `limit`.
- Cache simples em memoria quando possivel (ex: channelDirectory).
- Evite reprocessamento: `job_locks` + idempotencia.
- Para secrets nao criticos, use env vars com `SECRETS_ENV_FIRST=true`.
- Desligue features caras com `FEATURE_*` quando nao estiverem em uso.

## Observabilidade minima
- Logs de jobs com contagem de itens processados.
- Event log quando houver falhas de billing ou robo.
