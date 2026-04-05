import * as crypto from "crypto";

function normalizeIdPart(input: string | number | null | undefined, maxLen = 32): string {
  const raw = String(input ?? "").trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const clipped = cleaned.slice(0, maxLen);
  return clipped || "na";
}

function timeRandomSuffix(): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString("hex");
  return `${ts}${rand}`;
}

function buildId(prefix: string, parts: Array<string | number | null | undefined>, withSuffix: boolean): string {
  const normalized = parts.map((p) => normalizeIdPart(p)).filter(Boolean);
  const suffix = withSuffix ? timeRandomSuffix() : null;
  return [normalizeIdPart(prefix, 24), ...normalized, ...(suffix ? [suffix] : [])].join("_");
}

export function makeDeterministicId(prefix: string, parts: Array<string | number | null | undefined>): string {
  return buildId(prefix, parts, false);
}

export function makeTimedId(prefix: string, parts: Array<string | number | null | undefined>): string {
  return buildId(prefix, parts, true);
}

function dateKeyUtc(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

export function makeOrderId(tenantId: string, userId: string): string {
  return makeTimedId("ord", [tenantId, userId]);
}

export function makeSessionId(userId: string): string {
  return makeTimedId("sess", [userId, dateKeyUtc()]);
}

export function makeIssueId(orderId: string, type: string): string {
  return makeDeterministicId("iss", [orderId, type]);
}

export function makeEventId(orderId: string, eventName: string): string {
  return makeTimedId("ev", [orderId, eventName]);
}

export function makeEventDayId(dayKey: string, eventName: string): string {
  return makeTimedId("evd", [dayKey, eventName]);
}

export function makeEmergencyHelpId(waId: string, orderId?: string | null): string {
  return makeTimedId("emh", [waId, orderId ?? "noorder"]);
}

export function makeFeedbackCancelId(orderId: string, waId: string): string {
  return makeDeterministicId("fb_cancel", [orderId, waId]);
}
