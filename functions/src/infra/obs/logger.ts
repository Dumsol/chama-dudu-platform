import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

export function logWith(ctx: Record<string, unknown>) {
  return log.child(ctx);
}
