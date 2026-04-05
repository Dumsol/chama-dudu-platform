import type { IntentName, SocialSignal } from "./types";

export type SocialActionHint = "continue" | "interrupt" | "cancel" | "disambiguate";

export interface SocialSignalRule {
  signal: SocialSignal;
  priority: number;
  minScore: number;
  aliases: string[];
  requiresContext?: boolean;
  forcedIntent?: IntentName;
  actionHint?: SocialActionHint;
}

export const SOCIAL_SIGNAL_CATALOG: SocialSignalRule[] = [
  {
    signal: "cancel",
    priority: 10,
    minScore: 0.84,
    forcedIntent: "cancelar",
    actionHint: "cancel",
    aliases: [
      "deixa isso",
      "esquece",
      "esquece isso",
      "mudei de ideia",
      "quero outra coisa",
      "quero outra coisa agora",
      "nao quero agora",
      "parar",
      "sair",
      "cancelar",
      "recomecar",
    ],
  },
  {
    signal: "human",
    priority: 20,
    minScore: 0.84,
    forcedIntent: "humano",
    actionHint: "interrupt",
    aliases: [
      "quero falar com humano",
      "quero falar com atendente",
      "falar com atendente",
      "humano",
      "atendente",
      "pessoa",
      "falar com alguem",
      "suporte",
    ],
  },
  {
    signal: "closure",
    priority: 30,
    minScore: 0.84,
    forcedIntent: "encerramento",
    actionHint: "interrupt",
    aliases: ["valeu", "so isso", "so isso valeu", "obrigado", "brigado", "tmj"],
  },
  {
    signal: "greeting",
    priority: 40,
    minScore: 0.82,
    forcedIntent: "saudacao",
    actionHint: "continue",
    aliases: [
      "oi",
      "oii",
      "oiii",
      "ola",
      "eae",
      "eai",
      "eaee",
      "eae meu mano",
      "fala",
      "fala dudu",
      "opa",
      "opaa",
      "salve",
      "bom dia",
      "boa tarde",
      "boa noite",
    ],
  },
  {
    signal: "small_talk",
    priority: 50,
    minScore: 0.8,
    actionHint: "disambiguate",
    aliases: ["dale", "dalee", "suave", "tranquilo", "meu mano", "irmao", "chefe", "patrao"],
  },
  {
    signal: "ack_short",
    priority: 60,
    minScore: 0.8,
    requiresContext: true,
    actionHint: "continue",
    aliases: ["fechou", "demorou", "blz", "beleza", "pode ser", "isso", "sim", "nao", "dale entao faz"],
  },
  {
    signal: "confusion",
    priority: 70,
    minScore: 0.82,
    forcedIntent: "reclamacao",
    actionHint: "interrupt",
    aliases: ["nao entendi", "nao era isso", "ta confuso", "to confuso", "bugou"],
  },
  {
    signal: "help",
    priority: 75,
    minScore: 0.86,
    forcedIntent: "menu",
    actionHint: "interrupt",
    aliases: ["menu"],
  },
  {
    signal: "help",
    priority: 80,
    minScore: 0.82,
    forcedIntent: "ajuda",
    actionHint: "interrupt",
    aliases: ["ajuda", "como funciona", "me ajuda", "socorro", "comandos"],
  },
];
