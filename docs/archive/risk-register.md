# RISK_REGISTER

- R1: Deploy de `firestore.indexes.json`/TTL ainda nao validado em prod; queries podem falhar/TTL nao ativar. Prob: media. Impacto: alto. Mitigacao: deploy e validação no console.
- R2: Secrets WhatsApp/Inter nao validados em ambiente alvo; risco de falha de runtime. Prob: media. Impacto: alto. Mitigacao: checklist de secrets + smoke test pos-deploy.
- R3: Limites reais da API WhatsApp (ban/rate) nao simulados em ambiente local. Prob: media. Impacto: alto. Mitigacao: rollout gradual + monitoramento de erros.
- R4: Crescimento de outbox/eventLog sem TTL; risco de custo. Prob: baixa. Impacto: medio. Mitigacao: definir politica de limpeza/TTL se volume crescer.
- R5: FEATURE_* flags podem ser ativadas indevidamente em prod. Prob: baixa. Impacto: medio. Mitigacao: checklist de flags no deploy.
