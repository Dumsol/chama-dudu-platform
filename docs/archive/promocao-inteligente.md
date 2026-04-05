# promocao-inteligente

## Visao geral
- Promocao Inteligente controla um budget semanal por deposito e ativa/desativa modulos com base em demanda.
- Raspadinha e o unico premio do MVP: taxa de servico gratis 1x (R$ 0,99).
- Tudo em centavos; weekKey faz reset semanal lazy (America/Sao_Paulo).

## Estados
- DISABLED: opt-in off ou nao elegivel (manualApproved/criterios/feature/kill switch).
- ACTIVE: demanda baixa + budget ok.
- PAUSED_BUDGET: estourou budget semanal.
- PAUSED_DEMAND_OK: demanda normalizada.

## Gates (obrigatorio)
Promo so roda se:
1) tenantKillSwitch = false
2) features.promoInteligente.enabled = true
3) deposito.promocaoInteligente.manualApproved = true
4) criterios min (minDeliveredOrdersLifetime, minScore) atendidos

Opt-in pode salvar budget mesmo se nao elegivel; status fica DISABLED ate liberar.

## Dados (Firestore)
- tenants/{tenantId}/products/dudu/depositos/{depositoId}/promoInteligente/state
- tenants/{tenantId}/products/dudu/depositos/{depositoId}/promoInteligenteLedger/{orderId}
- tenants/{tenantId}/products/dudu/config/features
- tenants/{tenantId}/products/dudu/audits/{auditId}

## Raspadinha (MVP travado)
- winProbBps = 1000 (10%)
- maxPrizeCents = 99
- maxWinsPerWeek = 10
- anti-fraude: deliveredAt - createdAt >= 5 min e acceptedAt presente

## Admin (feature flags)
Endpoint HTTP protegido:
- `dudu_promoAdminToggleV1` (header `x-admin-key`)
Payload exemplo:
```
{
  "tenantCnpj": "app",
  "tenantKillSwitch": false,
  "features": {
    "promoInteligente": { "enabled": true, "minDeliveredOrdersLifetime": 10, "minScore": 4.0 },
    "raspadinha": { "enabled": true },
    "gptAdvisor": { "enabled": false }
  },
  "depositoId": "dep_123",
  "manualApproved": true
}
```

## WhatsApp (deposito)
- "promocao inteligente" -> status completo
- "quais promocoes eu estou" -> lista de modulos
- "ativar promocao inteligente" -> pede budget
- "sair da promocao inteligente" -> pede motivo e desativa
