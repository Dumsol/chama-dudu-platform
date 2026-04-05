import assert from "node:assert";
import { parseFallbackResponse } from "../src/modules/ops/fallbackRouter";

function run(): void {
  const raw = JSON.stringify({
    role: "client",
    action: "buscar_depositos",
    confidence: 0.7,
    entities: { bairro: "Janga", pedidoId: null, depositoId: null, nome: null, observacao: null },
    reply_hint: null,
    should_ask_clarifying_question: false,
    clarifying_question: null,
    safe_reason: null,
  });
  const parsed = parseFallbackResponse(raw);
  assert(parsed);
  assert(parsed.action === "buscar_depositos");
  assert(parsed.confidence === 0.7);

  const lowConfidence = JSON.stringify({
    ...JSON.parse(raw),
    confidence: 0.4,
    action: "cancelar",
  });
  const forced = parseFallbackResponse(lowConfidence);
  assert(forced);
  assert(forced.action === "cancelar");
  assert(forced.confidence === 0.4);

  assert.strictEqual(parseFallbackResponse("not json"), null);

  console.log("tests/fallbackRouter.test.ts ok");
}

run();
