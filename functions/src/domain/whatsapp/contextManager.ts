import type { IntentName } from "./types";

type FlowSwitchRule = {
  pattern: RegExp;
  flow: "deposito_onboarding" | "cancel" | "restart" | "menu" | "help" | "greeting";
  forcedIntent: IntentName;
};

const FLOW_SWITCH_PATTERNS: FlowSwitchRule[] = [
  { pattern: /\bquero ser dep[oó]sit[oa]\b/i, flow: "deposito_onboarding", forcedIntent: "menu" },
  { pattern: /\bsou dep[oó]sit[oa]\b/i, flow: "deposito_onboarding", forcedIntent: "menu" },
  { pattern: /\bcancel(ar|a)\b/i, flow: "cancel", forcedIntent: "cancelar" },
  { pattern: /\bcome[cç]ar (de novo|tudo)\b/i, flow: "restart", forcedIntent: "menu" },
  { pattern: /\bmenu\b/i, flow: "menu", forcedIntent: "menu" },
  { pattern: /\bajuda\b/i, flow: "help", forcedIntent: "ajuda" },
  { pattern: /\b(oi|ola|ol[aá]|e a[ií]|eae|fala)\b/i, flow: "greeting", forcedIntent: "saudacao" },
];

export function detectFlowSwitch(text: string): { flow: FlowSwitchRule["flow"]; forcedIntent: IntentName } | null {
  const compact = String(text ?? "").trim();
  if (!compact) return null;
  for (const rule of FLOW_SWITCH_PATTERNS) {
    if (rule.pattern.test(compact)) {
      return { flow: rule.flow, forcedIntent: rule.forcedIntent };
    }
  }
  return null;
}
