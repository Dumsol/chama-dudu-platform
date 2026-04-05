import fs from "node:fs";
import path from "node:path";

const LEGACY_TOKEN = "chamadudu/app";
const FORBIDDEN_ROOT_COLLECTIONS = [
  "users",
  "depositos",
  "mensagens",
  "processedMessages",
  "precadastros",
  "rateLimits",
  "printQueue",
];
const FORBID_TEXTUAL_COLLECTION_IN_FILES = [
  path.join("modules", "billing", "billingService.ts"),
  path.join("modules", "depositos", "depositoService.ts"),
  path.join("modules", "orders", "orderService.ts"),
  path.join("modules", "orders", "orderRoutingService.ts"),
  path.join("modules", "issues", "issueService.ts"),
  path.join("modules", "common", "messageService.ts"),
  path.join("modules", "users", "sessionService.ts"),
  path.join("modules", "promo", "promoInteligente.ts"),
  path.join("modules", "ops", "fallbackRouter.ts"),
  path.join("modules", "whatsapp", "antiRepeat.ts"),
  path.join("infra", "jobs", "jobLock.ts"),
  path.join("infra", "obs", "eventLogService.ts"),
  path.join("jobs", "opsRobot.ts"),
  path.join("jobs", "legacyRootAuditMonitor.ts"),
];
const BUSINESS_COLLECTION_NAMES = [
  "users",
  "sessions",
  "messageSessions",
  "orders",
  "orders_done",
  "orders_public",
  "depositos",
  "depositosByWa",
  "routing_state",
  "issues",
  "billingCycles",
  "billingEvents",
  "job_locks",
  "wa_dedupe",
  "inboundProcessed",
  "outboundMessages",
  "outbox",
  "rate_limits",
  "userThrottle",
  "mediaCache",
  "mensagens",
  "processedMessages",
  "preCadastros",
  "conversas",
  "printQueue",
  "ping_interests",
  "events_days",
  "promo_history",
  "emergencyHelps",
  "promoInteligente",
  "promoInteligenteLedger",
  "counters",
  "sticker_cooldown",
  "openai_cooldown",
  "openaiFallbackRate",
  "outboundRepeat",
  "feedback_cancel",
  "dev_mode_auth",
  "events",
  "items",
];
const BUSINESS_COLLECTION_ALLOWED_FILES = [
  path.join("infra", "firestore", "duduPaths.ts"),
  path.join("tools", "legacyRootCollections.ts"),
  path.join("tools", "antiMerdaSmoke.ts"),
  path.join("tools", "smokeOpsV1.ts"),
];

function walk(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "lib") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") return false;
  return [".ts", ".js", ".json", ".txt", ".yml", ".yaml"].includes(ext);
}

function main(): void {
  const roots = ["src", "tests"]
    .map((segment) => path.resolve(process.cwd(), segment))
    .filter((segment) => fs.existsSync(segment));
  if (!roots.length) {
    console.error("noLegacyPathsCheck: src/ and tests/ not found");
    process.exit(1);
  }

  const matches: string[] = [];
  for (const root of roots) {
    for (const filePath of walk(root)) {
      if (!isTextFile(filePath)) continue;
      if (filePath.endsWith(path.join("tools", "noLegacyPathsCheck.ts"))) continue;
      if (filePath.endsWith(path.join("infra", "firestore", "duduPaths.ts"))) continue;
      if (filePath.endsWith(path.join("infra", "firestore", "channelDirectory.ts"))) continue;

      const content = fs.readFileSync(filePath, "utf8");
      if (content.includes(LEGACY_TOKEN)) {
        matches.push(`${path.relative(process.cwd(), filePath)} :: ${LEGACY_TOKEN}`);
      }

      for (const forbidden of FORBIDDEN_ROOT_COLLECTIONS) {
        const dbPattern = new RegExp(`db\\.collection\\("${forbidden}"\\)`);
        const firestorePattern = new RegExp(`firestore\\(\\)\\.collection\\("${forbidden}"\\)`);
        if (dbPattern.test(content) || firestorePattern.test(content)) {
          matches.push(`${path.relative(process.cwd(), filePath)} :: root_collection:${forbidden}`);
        }
      }

      const relative = path.relative(process.cwd(), filePath);
      const shouldForbidTextualCollection = FORBID_TEXTUAL_COLLECTION_IN_FILES.some((segment) =>
        relative.endsWith(path.join("src", segment)),
      );
      if (shouldForbidTextualCollection && /\.collection\("/.test(content)) {
        matches.push(`${relative} :: textual_collection_forbidden`);
      }

      const allowBusinessCollectionLiteral = BUSINESS_COLLECTION_ALLOWED_FILES.some((segment) =>
        relative.endsWith(path.join("src", segment)),
      );
      if (!allowBusinessCollectionLiteral) {
        for (const collection of BUSINESS_COLLECTION_NAMES) {
          const textualCollectionPattern = new RegExp(`\\.collection\\("${collection}"\\)`);
          if (textualCollectionPattern.test(content)) {
            matches.push(`${relative} :: business_collection_literal:${collection}`);
          }
        }
      }
    }
  }

  if (matches.length) {
    console.error("noLegacyPathsCheck: found forbidden legacy/root path usage");
    for (const match of matches) console.error(" -", match);
    process.exit(1);
  }

  console.log("noLegacyPathsCheck: PASS");
}

main();
