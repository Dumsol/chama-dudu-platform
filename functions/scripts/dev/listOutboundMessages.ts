import dotenv from "dotenv";
import { outboundMessagesCol } from "../../src/core/duduPaths";

const envPath = process.env.DOTENV_PATH ?? "local.env";
dotenv.config({ path: envPath });

function last4(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.slice(-4);
}

function shorten(value: string | null | undefined, max = 8): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

async function main(): Promise<void> {
  const limit = Number(process.env.LIMIT ?? "50");
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 50;
  const tenantCnpj = process.env.SINGLE_TENANT_CNPJ ?? "app";

  const snap = await outboundMessagesCol(tenantCnpj)
    .orderBy("createdAtMs", "desc")
    .limit(safeLimit)
    .get();

  console.log(`outboundMessages (tenant=${tenantCnpj}) count=${snap.size}`);

  for (const doc of snap.docs) {
    const data = doc.data() as any;
    const status = String(data.status ?? "");
    const type = String(data.type ?? "");
    const requestKind = String(data.requestKind ?? "");
    const err = data.errorCode ? `err=${data.errorCode}` : "";
    const msgId = shorten(data.returnedMessageId ?? null, 10);
    const corr = shorten(data.correlationId ?? doc.id, 10);
    const toLast4 = last4(data.toLast4 ?? "");
    const updated = data.statusUpdatedAtMs ?? data.lastAttemptAtMs ?? data.createdAtMs ?? "";

    console.log(
      [
        `id=${corr}`,
        `status=${status}`,
        `type=${type}`,
        `kind=${requestKind}`,
        toLast4 ? `to=***${toLast4}` : "to=***",
        msgId ? `msg=${msgId}` : "msg=",
        err,
        updated ? `ts=${updated}` : "ts=",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

main().catch((err) => {
  console.error("listOutboundMessages failed", err?.message ?? String(err));
  process.exitCode = 1;
});
