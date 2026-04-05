# INVESTIGATION - WhatsApp compliance

## Achados
1. `callWhatsAppAPI` aceitava `phone_number_id` sem validação ou log, o que deixava o serviço mandar URLs errados e depurar dificuldades por falta de contexto.
2. Sticker links disparavam direto para `/messages` sem baixar, validar ou garantir o `type` correto, resultando em falhas como `errorCode=131053`.
3. Logs de envio não capturavam `urlPath`, `phoneNumberIdRawSnippet`, `fbTraceId` de uploads nem informações de download, dificultando auditoria.

## Mudanças aplicadas
- Novo módulo `src/whatsapp/validators.ts` centraliza `phone_number_id`, `to`, `last4` e WebP validation com limites documentados (<=1 MiB).
- `callWhatsAppAPI` agora:
  * normaliza e valida `phoneNumberId`/`to`.
  * reusa informações sanitizadas no log `WA_CALL_URL_INFO`.
  * cancela a requisição antes do fetch em caso de dados errados.
- `resolveStickerMediaId` baixa o link, garante magic bytes `RIFF....WEBP`, checa `content-type` (tem que conter `webp`), respeita o limite de 1 MiB, faz upload com MIME correto e registra host/path/hash/size.
- Sticker send flow prioriza `mediaId`, mantém cache e registra `outboundMessages` com `fbTraceId`/`errorCode`. Logs adicionais permitem diagnosticar `WA_MEDIA_UPLOAD_*`.
- Documentação: `docs/WHATSAPP_COMPLIANCE.md` descreve a checklist e como investigar.
- Testes: `tests/whatsappValidators.test.ts` cobre validações e limitações de WebP. Rodar `npm run test:validators`.

## Riscos e mitigação
- **Risco**: downloads externos podem falhar e interromper o envio. **Mitigação**: erros agora gravam `outboundMessages` com `errorMessage` claro e o fallback de texto roda automaticamente.
- **Risco**: mudanças cruzam várias partes do transport layer. **Mitigação**: novos logs (`WA_CALL_URL_INFO`, `WA_MEDIA_UPLOAD_OK/FAILED`) e validações evitam regressões e facilitam rollback se necessário.
