# FALLBACK ROUTING (OpenAI)

## Objetivo
Quando a mensagem do cliente “parece ação” mas não se encaixa nos comandos hardcoded, o fallback chama o OpenAI para classificar a intenção em JSON estrito e segura a execução real apenas para actions da allowlist.

## Fluxo
1. Checa se `OPENAI_FALLBACK_ENABLED` está ativo (default `false`).
2. Garante rate limit de `5 calls / hour / waId` via `openaiFallbackRate/{waId}`.
3. Envia o prompt fixo (sem variações) para o modelo, com `model=gpt-4o-mini`, timeout de ~6s, temperature 0.
4. O modelo só responde JSON; o parser `parseFallbackResponse` valida com Zod antes de aceitar.
5. Se a resposta chega com `confidence < 0.65`, a ação é tratada como `unknown`.
6. Se a ação for validada e allowlist, o mesmo fluxo existente é acionado; caso contrário, o bot pergunta uma clarificação curta (usando `messaging/copy.ts`).

## Schema
- `role`: `client` | `deposit`
- `action`: allowlist com `buscar_depositos`, `pidir_localizacao`, `informar_bairro`, `fazer_pedido`, `status_pedido`, `cancelar`, `ajuda`, `humano`, `unknown`, `abrir`, `fechar`, `status`, `aceitar_pedido`, `recusar_pedido`
- `confidence`: 0..1 (se `unknown` precisa ≤0.65)
- `entities`: `bairro`, `pedidoId`, `depositoId`, `nome`, `observacao` (sempre presentes, `null` permitido)
- `reply_hint`, `clarifying_question`, `safe_reason`: `string | null`
- `should_ask_clarifying_question`: boolean

## Logs
- `OPENAI_FALLBACK_RATE_LIMIT`: quando a cota de 5/h é estourada.
- `OPENAI_FALLBACK_HTTP`: falhas HTTP.
- `OPENAI_FALLBACK_PARSE_FAIL`: JSON inválido.
- `OPENAI_FALLBACK_OK`: action/ confidence (sem texto do usuário).
- `OPENAI_FALLBACK_ERROR`: timeout ou exceção.

## Diagnóstico
1. Verifique `openaiFallbackRate/{waId}` para contagem e janela.
2. Use `OPENAI_FALLBACK_OK` para confirmar qual ação/ confiança foi inferida.
3. Se parsing falhar, veja `OPENAI_FALLBACK_PARSE_FAIL` e o snippet logado.
4. `docs/VOICE_TONE.md` indica como compor a pergunta de clarificação (usar `clarifyIntentCopy`).
