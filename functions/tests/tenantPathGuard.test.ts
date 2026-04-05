import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TARGET_MODULES = [
  "src/modules/billing/billingService.ts",
  "src/modules/depositos/depositoService.ts",
  "src/modules/orders/orderService.ts",
  "src/modules/orders/orderRoutingService.ts",
  "src/modules/issues/issueService.ts",
  "src/modules/common/messageService.ts",
  "src/modules/users/sessionService.ts",
  "src/modules/promo/promoInteligente.ts",
  "src/modules/ops/fallbackRouter.ts",
  "src/modules/whatsapp/antiRepeat.ts",
  "src/infra/jobs/jobLock.ts",
  "src/infra/obs/eventLogService.ts",
  "src/jobs/opsRobot.ts",
  "src/jobs/legacyRootAuditMonitor.ts",
];

describe("tenant path guard for legacy modules", () => {
  for (const relativeFile of TARGET_MODULES) {
    it(`forbids textual collection() usage in ${relativeFile}`, () => {
      const absolute = path.resolve(process.cwd(), relativeFile);
      const content = fs.readFileSync(absolute, "utf8");
      expect(content.includes('.collection("')).toBe(false);
    });
  }
});
