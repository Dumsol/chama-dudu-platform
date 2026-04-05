export interface AgentPayload {
  sessionId?: string;
  role?: string;
  intent?: string;
  intentConfidence?: number;
  currentBotState?: string;
  /** Próximo estado FSM. Pode vir como nextBotState ou nextSafeAction (legado). */
  nextBotState?: string;
  nextSafeAction?: string;
  effectiveEntities?: Record<string, unknown>;
  whatsappButtons?: unknown;
  fallbackUsed?: boolean;
  responseText?: string;
}

/**
 * Extrai o payload JSON de dentro das tags <json>...</json> na resposta do LLM.
 */
export function parseAgentPayload(rawResponse: string): AgentPayload | null {
  try {
    const match = rawResponse.match(/<json>([\s\S]*?)<\/json>/);
    if (!match) return null;
    const payload = JSON.parse(match[1]) as AgentPayload;
    // nextSafeAction é legado; normaliza para nextBotState se presente
    if (!payload.nextBotState && payload.nextSafeAction) {
      payload.nextBotState = payload.nextSafeAction;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Remove as tags <json> e retorna apenas o texto destinado ao usuário.
 */
export function extractResponseText(rawResponse: string): string {
  // Se há <json>, remove todas as ocorrências
  const withoutJson = rawResponse.replace(/<json>[\s\S]*?<\/json>/g, "").trim();
  
  // Se removemos o JSON e sobrou nada, mas havia tags <json>, 
  // significa que o LLM só mandou dados técnicos. Retornamos "" 
  // para ser tratado no Engine como um "fallback human" seguro.
  if (!withoutJson && rawResponse.includes("<json>")) {
    return "";
  }

  // Se não tem <json>, retorna o trim do original
  return withoutJson || rawResponse.trim();
}
