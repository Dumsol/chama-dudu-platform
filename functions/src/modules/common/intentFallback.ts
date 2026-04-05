export type ResolveIntentSource = "hardcoded" | "gemini" | "unknown";

export type ResolveIntentResult<A extends string> = {
  action: A | "unknown";
  source: ResolveIntentSource;
  confidence?: number;
  geminiAction?: string;
  calledAi: boolean;
  blockedReason?: "UNMAPPED" | "MISSING_REQUIREMENT";
};

export async function resolveIntentWithFallback<A extends string>(params: {
  role: "client" | "deposit";
  waId: string;
  text: string;
  isTextOnly: boolean;
  allowFallback: boolean;
  hardcodedAction: A | null;
  inferActionFn: (args: {
    waId: string;
    role: "client" | "deposit";
    text: string;
    context?: string[];
    tenantCnpj?: string;
  }) => Promise<{ action: string; confidence: number } | null>;
  mapGeminiAction: (
    action: string,
    confidence: number,
  ) => { action: A | null; reason?: "UNMAPPED" | "MISSING_REQUIREMENT" };
  context?: string[];
  tenantCnpj?: string;
  minConfidence?: number;
}): Promise<ResolveIntentResult<A>> {
  if (params.hardcodedAction) {
    return {
      action: params.hardcodedAction,
      source: "hardcoded",
      calledAi: false,
    };
  }

  if (!params.allowFallback || !params.isTextOnly) {
    return {
      action: "unknown",
      source: "unknown",
      calledAi: false,
    };
  }

  const result = await params.inferActionFn({
    waId: params.waId,
    role: params.role,
    text: params.text,
    context: params.context,
    tenantCnpj: params.tenantCnpj,
  });

  if (!result) {
    return {
      action: "unknown",
      source: "unknown",
      calledAi: true,
    };
  }

  const confidence = Number(result.confidence ?? 0);
  const min = Number(params.minConfidence ?? 0.65);
  if (result.action === "unknown" || confidence < min) {
    return {
      action: "unknown",
      source: "unknown",
      confidence,
      geminiAction: result.action,
      calledAi: true,
    };
  }

  const mapped = params.mapGeminiAction(result.action, confidence);
  if (!mapped.action) {
    return {
      action: "unknown",
      source: "unknown",
      confidence,
      geminiAction: result.action,
      calledAi: true,
      blockedReason: mapped.reason ?? "UNMAPPED",
    };
  }

  return {
    action: mapped.action,
    source: "gemini",
    confidence,
    geminiAction: result.action,
    calledAi: true,
  };
}
