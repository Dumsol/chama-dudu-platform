// functions/src/config/guardrails.ts


export function assertRequiredConfig(params: {
  context: string;
  env?: string[];
  secrets?: Array<{ name: string; secret: { value: () => string } }>;
}): void {
  const missing: string[] = [];

  if (params.env) {
    for (const key of params.env) {
      const value = process.env[key];
      if (!value || !String(value).trim()) missing.push(key);
    }
  }

  if (params.secrets) {
    for (const s of params.secrets) {
      const val = typeof s.secret === "string" ? s.secret : (s.secret as any)?.value?.();
      if (!val || !String(val).trim()) missing.push(s.name);
    }
  }

  if (missing.length) {
    throw new Error(
      `[${params.context}] Config obrigatoria ausente: ${missing.join(", ")}`,
    );
  }
}
