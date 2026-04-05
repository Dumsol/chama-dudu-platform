import assert from "node:assert";

import {
  buildRaspadinhaLedgerId,
  decidePromoStatus,
  getWeekKeyForTimeZone,
  parsePromoCommand,
} from "../src/modules/promo/promoInteligente";

function run(): void {
  assert.strictEqual(parsePromoCommand("promocao inteligente"), "STATUS");
  assert.strictEqual(parsePromoCommand("quais promocoes eu estou"), "LIST");
  assert.strictEqual(parsePromoCommand("sair da promocao inteligente"), "OPT_OUT");
  assert.strictEqual(parsePromoCommand("ativar promocao inteligente"), "OPT_IN");

  const wk = getWeekKeyForTimeZone(Date.UTC(2026, 0, 5, 12, 0, 0), "America/Sao_Paulo");
  assert.strictEqual(wk, "2026-W02");

  const active = decidePromoStatus({
    optIn: true,
    isAberto: true,
    weeklyBudgetCents: 3000,
    spentThisWeekCents: 0,
    demandLow: true,
  });
  assert.strictEqual(active, "ACTIVE");

  const paused = decidePromoStatus({
    optIn: true,
    isAberto: true,
    weeklyBudgetCents: 3000,
    spentThisWeekCents: 0,
    demandLow: false,
  });
  assert.strictEqual(paused, "PAUSED_DEMAND_OK");

  assert.strictEqual(buildRaspadinhaLedgerId("order_123"), "order_123");

  console.log("tests/promoInteligente.test.ts ok");
}

run();
