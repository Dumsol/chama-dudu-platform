import { db } from "../config/firebase";


export function assertTenantId(rawTenantId: string | null | undefined): string {
  const tenantId = String(rawTenantId ?? "").trim();
  if (!tenantId) {
    throw new Error("tenantId is required for tenant-scoped Firestore access");
  }
  return tenantId;
}

export function tenantsCol() {
  // O usuário especificou que a estrutura correta é /tenants/app/products/[nome do app]
  // Portanto, a coleção de "tenants" (apps) agora é a subcoleção "products" sob o documento "app".
  return db.collection("tenants").doc("app").collection("products");
}

export function tenantDoc(tenantId: string) {
  return tenantsCol().doc(assertTenantId(tenantId));
}

export function productDoc(tenantId: string) {
  // Na nova estrutura, o "documento do produto" é o próprio documento do tenant/app.
  return tenantDoc(tenantId);
}

export function usersCol(tenantId: string) {
  return productDoc(tenantId).collection("users");
}

export function userSessionsCol(tenantId: string, userId: string) {
  return usersCol(tenantId).doc(userId).collection("sessions");
}

export function userMessageSessionsCol(tenantId: string, userId: string) {
  return usersCol(tenantId).doc(userId).collection("messageSessions");
}

export function ordersCol(tenantId: string) {
  return productDoc(tenantId).collection("orders");
}

export function orderEventsCol(tenantId: string, orderId: string) {
  return ordersCol(tenantId).doc(orderId).collection("events");
}

export function orderMatchingSnapshotsCol(tenantId: string, orderId: string) {
  return ordersCol(tenantId).doc(orderId).collection("matching_snapshots");
}

export function ordersDoneCol(tenantId: string) {
  return productDoc(tenantId).collection("orders_done");
}

export function ordersPublicCol(tenantId: string) {
  return productDoc(tenantId).collection("orders_public");
}

export function depositosCol(tenantId: string) {
  return productDoc(tenantId).collection("depositos");
}

export function promoStateDoc(tenantId: string, depositoId: string) {
  return depositosCol(tenantId).doc(depositoId).collection("promoInteligente").doc("state");
}

export function promoLedgerCol(tenantId: string, depositoId: string) {
  return depositosCol(tenantId).doc(depositoId).collection("promoInteligenteLedger");
}

export function depositosByWaCol(tenantId: string) {
  return productDoc(tenantId).collection("depositosByWa");
}

export function routingStateCol(tenantId: string) {
  return productDoc(tenantId).collection("routing_state");
}

export function routingRrStateDoc(tenantId: string) {
  return routingStateCol(tenantId).doc("__global__");
}

export function issuesCol(tenantId: string) {
  return productDoc(tenantId).collection("issues");
}

export function orderIssuesCol(tenantId: string, orderId: string) {
  return ordersCol(tenantId).doc(orderId).collection("issues");
}

export function billingCyclesCol(tenantId: string) {
  return productDoc(tenantId).collection("billingCycles");
}

export function billingEventsCol(tenantId: string) {
  return productDoc(tenantId).collection("billingEvents");
}

export function jobLocksCol(tenantId: string) {
  return productDoc(tenantId).collection("job_locks");
}

export function waDedupeCol(tenantId: string) {
  return productDoc(tenantId).collection("wa_dedupe");
}

export function inboundProcessedCol(tenantId: string) {
  return productDoc(tenantId).collection("inboundProcessed");
}

export function outboundMessagesCol(tenantId: string) {
  return productDoc(tenantId).collection("outboundMessages");
}

export function outboxCol(tenantId: string) {
  return productDoc(tenantId).collection("outbox");
}

export function rateLimitsCol(tenantId: string) {
  return productDoc(tenantId).collection("rate_limits");
}

export function userThrottleCol(tenantId: string) {
  return productDoc(tenantId).collection("userThrottle");
}

export function mediaCacheCol(tenantId: string) {
  return productDoc(tenantId).collection("mediaCache");
}

export function messagesCol(tenantId: string) {
  return productDoc(tenantId).collection("mensagens");
}

export function processedMessagesCol(tenantId: string) {
  return productDoc(tenantId).collection("processedMessages");
}

export function preCadastrosCol(tenantId: string) {
  return productDoc(tenantId).collection("preCadastros");
}

export function conversationsCol(tenantId: string) {
  return productDoc(tenantId).collection("conversas");
}

export function printQueueCol(tenantId: string) {
  return productDoc(tenantId).collection("printQueue");
}

export function pingInterestsCol(tenantId: string) {
  return productDoc(tenantId).collection("ping_interests");
}

export function dayEventsItemsCol(tenantId: string, dayKey: string) {
  return eventsDaysCol(tenantId).doc(dayKey).collection("items");
}

export function eventsDaysCol(tenantId: string) {
  return productDoc(tenantId).collection("events_days");
}

export function opsSnapshotsCol(tenantId: string) {
  return productDoc(tenantId).collection("ops_snapshots");
}

export function opsRealtimeCol(tenantId: string) {
  return productDoc(tenantId).collection("ops_realtime");
}

export function promoHistoryCol(tenantId: string) {
  return productDoc(tenantId).collection("promo_history");
}

export function emergencyHelpsCol(tenantId: string) {
  return productDoc(tenantId).collection("emergencyHelps");
}

export function tenantConfigDoc(tenantId: string) {
  return productDoc(tenantId).collection("config").doc("features");
}

export function auditsCol(tenantId: string) {
  return productDoc(tenantId).collection("audits");
}

export function devModeAuthCol(tenantId: string) {
  return productDoc(tenantId).collection("dev_mode_auth");
}

export function channelDirectoryCol() {
  return db.collection("platform").doc("channelDirectory").collection("directory");
}

export function countersCol(tenantId: string) {
  return productDoc(tenantId).collection("counters");
}

export function stickerCooldownCol(tenantId: string) {
  return productDoc(tenantId).collection("sticker_cooldown");
}

export function aiCooldownCol(tenantId: string) {
  return productDoc(tenantId).collection("ai_cooldown");
}

export function geminiFallbackRateCol(tenantId: string) {
  return productDoc(tenantId).collection("geminiFallbackRate");
}

export function geminiGuideRateCol(tenantId: string) {
  return productDoc(tenantId).collection("geminiGuideRate");
}

export function geminiGuideCacheCol(tenantId: string) {
  return productDoc(tenantId).collection("geminiGuideCache");
}

export function geminiGuideAuditCol(tenantId: string) {
  return productDoc(tenantId).collection("geminiGuideAudit");
}

export function outboundRepeatCol(tenantId: string) {
  return productDoc(tenantId).collection("outboundRepeat");
}

export function feedbackCancelCol(tenantId: string) {
  return productDoc(tenantId).collection("feedback_cancel");
}

export function forbiddenPhraseAlertsCol(tenantId: string) {
  return productDoc(tenantId).collection("forbiddenPhraseAlerts");
}

export function indicacoesCol(tenantId: string) {
  return productDoc(tenantId).collection("indicacoes");
}

export function platformAuditProjectsCol() {
  return db.collection("platform").doc("opsLegacyRootAudit").collection("projects");
}

export function platformAuditRunsCol(projectId: string) {
  return platformAuditProjectsCol().doc(projectId).collection("runs");
}

export function platformAuditAlertsCol(projectId: string) {
  return platformAuditProjectsCol().doc(projectId).collection("alerts");
}
