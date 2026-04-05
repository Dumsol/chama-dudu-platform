// functions/src/config/featureFlags.ts
function parseBool(value: string | undefined | null, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return defaultValue;
}

/**
 * Kill switch via env vars.
 * Ex: FEATURE_SLA_ENABLED=false
 */
export function isFeatureEnabled(flagName: string, defaultValue = true): boolean {
  const key = flagName.startsWith("FEATURE_") ? flagName : `FEATURE_${flagName}`;
  return parseBool(process.env[key], defaultValue);
}
