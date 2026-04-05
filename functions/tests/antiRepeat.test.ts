import assert from "node:assert";
import { buildOutboundHash, shouldBlockRepeat } from "../src/modules/whatsapp/antiRepeat";

function run(): void {
  const hashA = buildOutboundHash("text", "olá");
  const hashB = buildOutboundHash("text", "tchau");

  assert(hashA !== hashB);

  const entry = { hash: hashA, atMs: Date.now() };
  assert.strictEqual(shouldBlockRepeat(entry, hashA, 1000, entry.atMs + 500), true);
  assert.strictEqual(shouldBlockRepeat(entry, hashA, 1000, entry.atMs + 1500), false);
  assert.strictEqual(shouldBlockRepeat(entry, hashB, 1000, entry.atMs + 500), false);

  console.log("tests/antiRepeat.test.ts ok");
}

run();
