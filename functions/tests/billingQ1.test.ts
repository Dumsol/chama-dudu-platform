import assert from "node:assert";
import {
  buildCycleIdForDeposito,
  hasOverdueOpenCycle,
  resolveCycleTransition,
} from "../src/billing/billingService";
import { computeWeeklyFee } from "../src/billing/feeCalculator";

function run(): void {
  const fee = computeWeeklyFee({
    deliveredCount: 10,
    gmvCentavos: 120000,
    serviceFeeRepasseCentavos: 990,
    platformCommissionCentavos: 1500,
  });

  assert.strictEqual(fee.deliveredCount, 10);
  assert.strictEqual(fee.gmvCentavos, 120000);
  assert.strictEqual(fee.serviceFeeRepasseCentavos, 990);
  assert.strictEqual(fee.platformCommissionCentavos, 1500);
  assert.strictEqual(fee.totalCentavos, 2490);

  const cycleA = buildCycleIdForDeposito("dep_123", "2025W05");
  const cycleB = buildCycleIdForDeposito("dep_123", "2025W05");
  assert.strictEqual(cycleA, cycleB);

  assert.strictEqual(
    resolveCycleTransition({ currentStatus: "OPEN", paid: true, expired: false }),
    "PAID",
  );
  assert.strictEqual(
    resolveCycleTransition({ currentStatus: "OPEN", paid: false, expired: true }),
    "EXPIRED",
  );
  assert.strictEqual(
    resolveCycleTransition({ currentStatus: "OPEN", paid: false, expired: false }),
    null,
  );
  assert.strictEqual(
    resolveCycleTransition({ currentStatus: "PAID", paid: true, expired: false }),
    null,
  );

  const now = Date.now();
  assert.strictEqual(
    hasOverdueOpenCycle({
      cycles: [{ status: "OPEN", expiresAtMs: null }],
      nowMs: now,
    }),
    true,
  );
  assert.strictEqual(
    hasOverdueOpenCycle({
      cycles: [{ status: "OPEN", expiresAtMs: now + 60000 }],
      nowMs: now,
    }),
    false,
  );
  assert.strictEqual(
    hasOverdueOpenCycle({
      cycles: [{ status: "EXPIRED", expiresAtMs: now - 1000 }],
      nowMs: now,
    }),
    true,
  );

  console.log("tests/billingQ1.test.ts ok");
}

run();
