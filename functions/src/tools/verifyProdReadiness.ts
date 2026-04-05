type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

function getEnv(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function isPositiveInteger(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  return Number(value) > 0;
}

function isPercent(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function checkTokenStrength(name: string): CheckResult {
  const value = getEnv(name);
  if (!value) {
    return { name, ok: false, detail: "ausente" };
  }
  if (value.length < 32) {
    return { name, ok: false, detail: `muito curto (${value.length})` };
  }
  return { name, ok: true, detail: `ok (${value.length} chars)` };
}

function checkOptionalPreviousTokenWindow(): CheckResult {
  const previous = getEnv("DEV_TOKEN_PREVIOUS");
  const until = getEnv("DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS");
  if (!previous && !until) {
    return {
      name: "DEV_TOKEN_PREVIOUS/DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS",
      ok: true,
      detail: "nao configurado (ok, sem janela de transicao)",
    };
  }
  if (!previous) {
    return {
      name: "DEV_TOKEN_PREVIOUS/DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS",
      ok: false,
      detail: "DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS setado sem DEV_TOKEN_PREVIOUS",
    };
  }
  if (!until || !isPositiveInteger(until)) {
    return {
      name: "DEV_TOKEN_PREVIOUS/DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS",
      ok: false,
      detail: "janela invalida para token anterior",
    };
  }
  return {
    name: "DEV_TOKEN_PREVIOUS/DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS",
    ok: true,
    detail: "janela de transicao ativa",
  };
}

function checkRequiredTenantList(): CheckResult {
  const tenants = getEnv("ROLLOUT_REQUIRED_TENANTS")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!tenants.length) {
    return { name: "ROLLOUT_REQUIRED_TENANTS", ok: false, detail: "vazio" };
  }
  return {
    name: "ROLLOUT_REQUIRED_TENANTS",
    ok: true,
    detail: `${tenants.length} tenant(s): ${tenants.join(", ")}`,
  };
}

function checkTtl(name: string, min: number, max: number): CheckResult {
  const raw = getEnv(name);
  if (!isPositiveInteger(raw)) {
    return { name, ok: false, detail: "deve ser inteiro positivo em ms" };
  }
  const n = Number(raw);
  if (n < min || n > max) {
    return { name, ok: false, detail: `fora da faixa recomendada [${min}, ${max}]` };
  }
  return { name, ok: true, detail: `ok (${n}ms)` };
}

function checkIntRange(name: string, min: number, max: number): CheckResult {
  const raw = getEnv(name);
  if (!isPositiveInteger(raw)) {
    return { name, ok: false, detail: "deve ser inteiro positivo" };
  }
  const n = Number(raw);
  if (n < min || n > max) {
    return { name, ok: false, detail: `fora da faixa recomendada [${min}, ${max}]` };
  }
  return { name, ok: true, detail: `ok (${n})` };
}

function checkPercentEnv(name: string): CheckResult {
  const raw = getEnv(name);
  if (!raw) {
    return { name, ok: true, detail: "nao setado (usa default)" };
  }
  if (!isPercent(raw)) {
    return { name, ok: false, detail: "deve estar entre 0 e 100" };
  }
  return { name, ok: true, detail: `ok (${raw}%)` };
}

function checkAdminKey(): CheckResult {
  const value = getEnv("KOSH_PROD_DUDU_ADMIN_API_KEY");
  if (!value) {
    return { name: "KOSH_PROD_DUDU_ADMIN_API_KEY", ok: false, detail: "ausente" };
  }
  if (value.length < 24) {
    return { name: "KOSH_PROD_DUDU_ADMIN_API_KEY", ok: false, detail: "fraco (min 24 chars)" };
  }
  return { name: "KOSH_PROD_DUDU_ADMIN_API_KEY", ok: true, detail: "ok" };
}

function runChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  results.push({ name: "PROJECT_ID", ok: Boolean(getEnv("PROJECT_ID")), detail: getEnv("PROJECT_ID") || "ausente" });
  results.push(checkRequiredTenantList());
  results.push(checkAdminKey());
  results.push(checkTokenStrength("DEV_TOKEN_CURRENT"));
  results.push(checkOptionalPreviousTokenWindow());
  results.push(checkTtl("DEV_SESSION_TTL_MS", 300000, 7200000));
  results.push(checkTtl("DEV_AUTH_LOCK_MS", 60000, 86400000));
  results.push(checkIntRange("DEV_PASSWORD_MAX_ATTEMPTS", 1, 10));
  results.push(checkPercentEnv("ROLLOUT_BLOCKED_ALERT_PCT"));
  results.push(checkTtl("ORDER_CONTEXT_TTL_MS", 60000, 86400000));
  results.push(checkTtl("ORDER_SELECTION_TTL_MS", 60000, 86400000));
  results.push(checkTtl("ORDER_AWAIT_DEPOSITO_MS", 60000, 86400000));
  results.push(checkIntRange("ORDER_MAX_FORWARD_ATTEMPTS", 1, 10));
  return results;
}

function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const icon = result.ok ? "PASS" : "FAIL";
    console.log(`${icon} ${result.name}: ${result.detail}`);
  }
}

function main(): void {
  const results = runChecks();
  printResults(results);
  const failures = results.filter((item) => !item.ok);
  if (failures.length) {
    console.error(`verifyProdReadiness: FAIL (${failures.length} check(s) invalidos)`);
    process.exit(1);
  }
  console.log("verifyProdReadiness: PASS");
}

main();
