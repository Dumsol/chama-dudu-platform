import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

const FORBIDDEN_PHRASES = [
  "ainda nao saquei certinho",
  "nao saquei certinho",
  "peguei redondo",
  "encaixar uma parte",
  "posso te ajudar melhor se",
  "me disser rapidinho",
  "o que quer resolver agora",
  "o que voce quer fazer agora",
];

const ALLOWLIST = new Set([
  path.normalize("domain/whatsapp/outputInterceptor.ts"),
  path.normalize("tools/forbiddenPhraseGuard.ts"),
]);

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(abs));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|js)$/i.test(entry.name)) continue;
    out.push(abs);
  }
  return out;
}

function normalizeText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function scanFile(absPath: string): string[] {
  const rel = path.normalize(path.relative(ROOT, absPath));
  if (ALLOWLIST.has(rel)) return [];
  const raw = readFileSync(absPath, "utf8");
  const normalized = normalizeText(raw);
  return FORBIDDEN_PHRASES.filter((phrase) => normalized.includes(phrase));
}

function main(): void {
  const files = walk(ROOT);
  const violations: Array<{ file: string; phrases: string[] }> = [];
  for (const file of files) {
    if (!statSync(file).isFile()) continue;
    const hits = scanFile(file);
    if (hits.length > 0) {
      violations.push({
        file: path.relative(process.cwd(), file),
        phrases: hits,
      });
    }
  }

  if (!violations.length) {
    process.stdout.write("FORBIDDEN_PHRASE_GUARD_OK\n");
    return;
  }

  for (const violation of violations) {
    process.stderr.write(`FORBIDDEN_PHRASE_GUARD_FAIL ${violation.file} -> ${violation.phrases.join(", ")}\n`);
  }
  process.exitCode = 1;
}

main();
