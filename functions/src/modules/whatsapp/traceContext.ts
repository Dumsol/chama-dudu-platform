import { AsyncLocalStorage } from "node:async_hooks";

export type TraceContext = {
  tenantCnpj: string;
  inboundMessageId: string | null;
  inboundCorrelationId: string | null;
  fromLast4: string | null;
  phoneNumberId: string | null;
};

const storage = new AsyncLocalStorage<TraceContext>();

export function runWithTraceContext<T>(
  context: TraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function enterTraceContext(context: TraceContext): void {
  storage.enterWith(context);
}

export function getTraceContext(): TraceContext | null {
  return storage.getStore() ?? null;
}
