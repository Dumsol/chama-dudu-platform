import { z } from "zod";
import { normalizeBrazilWhatsApp } from "./ddd";

export const preCadastroSchema = z.object({
  nomeDeposito: z.string().trim().min(2).max(120),
  responsavel: z.string().trim().min(2).max(120),
  whatsapp: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .transform((value, ctx) => {
      const parsed = normalizeBrazilWhatsApp(value);
      if (!parsed.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "whatsapp_invalido",
        });
        return "";
      }
      return parsed.normalized;
    }),
  bairro: z.string().trim().min(2).max(120),
  cidade: z.string().trim().min(2).max(120).optional(),
  cnpj: z.string().trim().max(20).optional(),
  /** Hash do token de acesso. Gerado pelo site antes do POST e salvo no Firestore. */
  tokenHash: z.string().trim().max(128).optional(),
});

export type PreCadastroPayload = z.infer<typeof preCadastroSchema>;
