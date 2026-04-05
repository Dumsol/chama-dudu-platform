import type { PreCadastroRecord } from "../precadastro/types";
import type { PedidoCanalFlow } from "./orderMatching";
import type { MatchingRolloutConfig } from "./matchingRollout";

export type MessageDirection = "in" | "out";
export type UserType = "cliente" | "deposito";
export type UserBotState =
  | "idle"
  | "ordering"
  | "neighborhood_selection"
  | "product_selection"
  | "awaiting_neighborhood"
  | "awaiting_product"
  | "awaiting_beverage_clarification"
  | "awaiting_vasilhame"
  | "awaiting_checkout"
  | "awaiting_deposit_response"
  | "offer_presented"
  | "awaiting_confirm"
  | "order_placed"
  | "dev_mode"
  | "address_collect"
  | "payment_method"
  | "order_confirmation"
  | "human_handoff"
  | "bairro_confirmation"
  | "awaiting_delivery_address"
  | "deposito_signup_site_offered"
  | "deposito_signup_start"
  | "deposito_signup_responsavel"
  | "deposito_signup_nome"
  | "deposito_signup_whatsapp"
  | "deposito_signup_cidade"
  | "deposito_signup_bairro"
  | "deposito_signup_cnpj"
  | "deposito_signup_frota"
  | "deposito_signup_confirm";

export type IntentName =
  | "deposito_abrir"
  | "deposito_fechar"
  | "deposito_status"
  | "deposito_pedidos_menu"
  | "deposito_pedido_atual"
  | "deposito_aceitar_pedido"
  | "deposito_recusar_pedido"
  | "deposito_iniciar_preparo"
  | "deposito_definir_eta"
  | "deposito_sair_entrega"
  | "deposito_concluir_entrega"
  | "deposito_pausar"
  | "cliente_buscar_deposito"
  | "cliente_iniciar_pedido"
  | "cliente_informar_bairro"
  | "cliente_consultar_horario"
  | "cliente_consultar_entrega"
  | "cliente_consultar_produtos"
  | "cliente_menu"
  | "cliente_iniciar_precadastro"
  | "cliente_confirmar_pedido"
  | "cliente_alterar_pedido"
  | "saudacao"
  | "encerramento"
  | "ajuda"
  | "menu"
  | "cancelar"
  | "reclamacao"
  | "humano"
  | "fallback"
  | "desconhecida";

export type ConfirmationEntity = "sim" | "nao";
export type StatusOperacionalEntity = "abrir" | "fechar" | "status";

export type SocialSignal =
  | "cancel"
  | "human"
  | "closure"
  | "greeting"
  | "small_talk"
  | "ack_short"
  | "confusion"
  | "help"
  | "signup_difficulty";

export type FallbackType = "fallback_social" | "fallback_desambiguacao" | "fallback_operacional";

export interface WhatsAppInboundMessage {
  phoneNumberId: string;
  messageId: string;
  waId: string | null;  // Pode ser nulo se o usuário adotar username e ocultar telefone
  bsuId?: string;       // BSUID (Business-scoped User ID)
  waUsername?: string;  // Nome de usuário do WhatsApp (ex: @dudu)
  type: string;
  timestamp: string | null;
  text: string | null;
  interactiveId: string | null;
  interactiveTitle: string | null;
  profileName: string | null;
  sourceKind: "text" | "interactive" | "button" | "location" | "media" | "unknown";
  location?: {
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    name: string | null;
  } | null;
}


export interface BotResponse {
  body: string;
  buttons?: Array<{ id: string; title: string }>;
  stickerName?: string;
  policyEvent?: string;
  isLocationRequest?: boolean;
  pdfUrl?: string;
  list?: {
    buttonLabel: string;
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
  interimMessage?: string;
}

export interface WhatsAppStatusEvent {
  phoneNumberId: string;
  messageId: string;
  status: string;
  recipientWaId: string | null;
  timestamp: string | null;
  errorCode: string | null;
  errorTitle: string | null;
}

export interface ParsedWebhookEnvelope {
  messages: WhatsAppInboundMessage[];
  statuses: WhatsAppStatusEvent[];
}

export interface TenantRecord {
  tenantId: string;
  phoneNumberId: string;
}

export interface UserRecord {
  userId: string;
  tenantId: string;
  waId: string | null;
  bsuId?: string;
  waUsername?: string;
  type: UserType;
  role: "cliente" | "deposito";
  name?: string;
  bairro?: string;
  bairroNorm?: string | null;
  beverage?: string | null;
  beverageBrand?: string | null;
  beverageVolumeMl?: number | null;
  beveragePackType?: "lata" | "long_neck" | "garrafa" | "pack" | "litrão" | null;
  hasVasilhame?: boolean | null;
  clarificationRequired?: boolean | null;
  clarificationType?: "embalagem" | "vasilhame" | "volume" | null;
  packagingResolved?: boolean | null;
  ageConfirmed?: boolean;
  ageConfirmedAt?: number | null; // Timestamp em MS
  /** Forma de pagamento escolhida no checkout: pix, cartao, dinheiro */
  paymentMethod?: "pix" | "cartao" | "dinheiro" | null;
  botState: UserBotState;
  botStateExpiresAtMs?: number | null;
  conversationHistory: Array<{ role: "user" | "model" | "system"; content: string; timestampMs: number }>;
  activeOrderId: string | null;
  fallbackCount: number;
  lastActivityAtMs: number;
  pendingOffers: any[]; // Ofertas aguardando o Ranking Matemático
  lastIntent?: IntentName | null;
  lastIntentConfidence?: number | null;
  slots?: {
    neighborhood?: string | null;
    product?: string | null;
    quantity?: number | null;
    confirmed?: boolean | null;
    responsavel?: string | null;
    depositoNome?: string | null;
    depositoWhatsapp?: string | null;
    depositoCidade?: string | null;
    depositoBairro?: string | null;
    depositoCnpj?: string | null;
    depositoFrota?: string | null;
  } | null;
  processingLock?: { messageId: string; expiresAt: number } | null;
}

export interface DepositoRecord {
  depositoId: string;
  tenantId: string;
  waId?: string | null;
  bsuId?: string;
  waUsername?: string;
  nomeDeposito?: string;
  bairro?: string;
  bairroNorm?: string;
  aberto: boolean;
  pausedUntilMs?: number | null;
  pauseReason?: string | null;
}

export interface ActiveOrderRecord {
  id: string;
  status: string;
  fulfillmentStatus: string;
  canal?: "DELIVERY" | "RETIRADA" | "CONSULTA" | null;
  depositoId?: string | null;
  tentativasDepositos?: string[] | null;
  bairro?: string | null;
  itensDescricao?: string | null;
  etaMin?: number | null;
  etaMinutes?: number | null;
  slaMinutes?: number | null;
  valorTotalPedido?: number | null;
  userId?: string | null;
  beverageBrand?: string | null;
  beverageVolumeMl?: number | null;
  beveragePackType?: string | null;
  hasVasilhame?: boolean | null;
  packagingResolved?: boolean | null;
  vasilhameRequired?: boolean | null;
  cancellationState?: "pending" | "cancelled_before_dispatch" | "dispatch_no_cancel" | null;
  evaluationState?: "pending" | "requested" | "completed" | "skipped" | null;
  evaluationScore?: number | null;
  fallbackReason?: string | null;
  routingReason?: string | null;
  matching?: {
    attemptNo?: number | null;
    snapshotVersion?: string | null;
    policyVersion?: string | null;
    policyHash?: string | null;
    selectedDepositoId?: string | null;
    selectionReason?: string | null;
    selectionScore?: number | null;
    eligibleCount?: number | null;
    depositsDataFingerprint?: string | null;
    rrPointerBefore?: number | null;
    rrPointerAfter?: number | null;
    forwardAttemptedAtMs?: number | null;
    forwardResult?: "forwarded" | "failed" | "diverged" | "skipped" | null;
    forwardFailureReason?: string | null;
  } | null;
}

export interface MatchingCandidate {
  depositoId: string;
  nome: string;
  waId: string;
  bairro: string;
  bairroNorm: string;
  score: number;
  weight: number;
  reasons: string[];
}

export interface MatchingExcludedCandidate {
  depositoId: string;
  nome: string;
  reasons: string[];
}

export interface MatchingSnapshotInputContext {
  bairro: string;
  bairroNorm: string;
  canal: "DELIVERY" | "RETIRADA" | "CONSULTA";
  intent: IntentName;
  userBotState: UserBotState;
}

export interface MatchingSnapshot {
  attemptNo: number;
  snapshotVersion: string;
  policyVersion: string;
  policyHash: string;
  inputContext: MatchingSnapshotInputContext;
  eligibleCandidates: MatchingCandidate[];
  excludedCandidates: MatchingExcludedCandidate[];
  rrPointerBefore: number;
  rrPointerAfter: number;
  selectedDepositoId: string | null;
  selectionReason: string;
  selectionScore: number | null;
  generatedAtMs: number;
  depositsDataFingerprint: string;
}

export interface PreCadastroInput {
  tenantId: string;
  nomeDeposito: string;
  responsavel: string;
  whatsapp: string;
  bairro: string;
  cidade?: string;
  cnpj?: string;
}

export interface MessageEntities {
  bairro: string | null;
  bairroNorm: string | null;
  cidade: string | null;
  confirmation: ConfirmationEntity | null;
  statusOperacional: StatusOperacionalEntity | null;
  beverage: string | null;
  orderIntent: boolean;
  quantity: string | null;
}

export interface IntentClassification {
  intent: IntentName;
  confidence: number;
  reasons: string[];
  alternatives: Array<{ intent: IntentName; score: number }>;
}

export type DecisionBand = "high" | "medium" | "low";

export interface MetaIntentDecision {
  action: "continue" | "interrupt" | "cancel" | "disambiguate";
  forcedIntent?: IntentName;
  confidence: number;
  reason: string;
  socialSignal?: SocialSignal;
  fallbackType?: FallbackType;
  usedContextForAckShort?: boolean;
}

export interface NormalizedMessage {
  raw: string;
  normalized: string;
  compact: string;
  tokens: string[];
}

export type GeminiGuideDecision =
  | { kind: "none"; reason: string }
  | {
      kind: "guide_decision";
      mode: "guide_only";
      confidence: number;
      nextSafeAction: "none" | "save_bairro" | "prefer_intent" | "ask_clarifying_question";
      bairroCandidate?: string;
      bairroNorm?: string;
      intentHint?: IntentName;
      clarifyingQuestionHint?: string;
      source: "model" | "cache";
      reason: string;
    }
  | {
      kind: "reply_assist_decision";
      mode: "reply_assist";
      confidence: number;
      replyPurpose: "clarify" | "partial_confirm" | "next_step" | "explain";
      replyText: string;
      source: "model" | "cache";
      reason: string;
    };

export interface MessageInterpretation {
  normalized: NormalizedMessage;
  classification: IntentClassification;
  entities: MessageEntities;
  metaIntent: MetaIntentDecision;
  geminiDecision: GeminiGuideDecision;
  effectiveIntent: IntentName;
  effectiveEntities: MessageEntities;
  effectiveClassification: IntentClassification;
  pendingSlotResult: any | null; // slotResolver result
  perf?: { nluMs: number };
}

export interface StateDecision {
  action: "reply" | "reset" | "noop" | "enqueue";
  nextState?: UserBotState;
  nextStep?: string;
  replyBody?: string | BotResponse;
}

export interface FlowRepository {
  getUserByTenantWaId: (tenantId: string, waId: string) => Promise<UserRecord | null>;
  findUserByBsuId: (tenantId: string, bsuId: string) => Promise<UserRecord | null>;
  upsertUser: (params: {
    tenantId: string;
    waId: string | null;
    bsuId?: string | null;
    waUsername?: string | null;
    name?: string | null;
    type: UserType;
    bairro?: string | null;
    bairroNorm?: string | null;
    botState: UserBotState;
    botStateExpiresAtMs?: number | null;
    conversationHistory?: UserRecord["conversationHistory"];
    activeOrderId?: string | null;
    fallbackCount?: number | null;
    lastActivityAtMs?: number;
    pendingOffers?: any[];
    lastIntent?: IntentName | null;
    lastIntentConfidence?: number | null;
    slots?: UserRecord["slots"] | null;
  }) => Promise<UserRecord>;
  findDepositoByTenantWaId: (tenantId: string, waId: string) => Promise<DepositoRecord | null>;
  ensureDepositoForWaId: (params: { tenantId: string; waId: string }) => Promise<DepositoRecord>;
  updateDepositoBairro: (params: { tenantId: string; depositoId: string; bairro: string; bairroNorm: string }) => Promise<void>;
  updateDepositoStatus: (params: { tenantId: string; depositoId: string; aberto: boolean }) => Promise<void>;
  setDepositoPause: (params: {
    tenantId: string;
    depositoId: string;
    minutes: number;
    reason?: string;
  }) => Promise<number>;
  getActiveOrderForDeposito: (params: { tenantId: string; depositoId: string }) => Promise<ActiveOrderRecord | null>;
  acceptOrder: (params: { tenantId: string; orderId: string }) => Promise<void>;
  declineOrder: (params: { tenantId: string; orderId: string; reason: string }) => Promise<void>;
  setOrderPreparing: (params: { tenantId: string; orderId: string }) => Promise<void>;
  setOrderEta: (params: { tenantId: string; orderId: string; etaMin: number; sourceText: string }) => Promise<void>;
  setOrderOutForDelivery: (params: { tenantId: string; orderId: string }) => Promise<void>;
  setOrderDelivered: (params: { tenantId: string; orderId: string }) => Promise<void>;
  findLatestPendingPreCadastroByWhatsApp: (tenantId: string, waId: string) => Promise<PreCadastroRecord | null>;
  updatePreCadastroConfirmation: (params: {
    tenantId: string;
    preCadastroId: string;
    status?: PreCadastroRecord["status"];
    confirmationStatus?: PreCadastroRecord["confirmationStatus"];
    confirmationStep?: PreCadastroRecord["confirmationStep"];
    confirmationDataPatch?: Partial<NonNullable<PreCadastroRecord["confirmationData"]>>;
  }) => Promise<void>;
  listOpenDepositosByBairro: (params: {
    tenantId: string;
    bairroNorm: string;
  }) => Promise<DepositoRecord[]>;
  getActiveOrderForUser: (params: { tenantId: string; userId: string }) => Promise<ActiveOrderRecord | null>;
  getOrderById: (params: { tenantId: string; orderId: string }) => Promise<ActiveOrderRecord | null>;
  createOrderForUser: (params: {
    tenantId: string;
    userId: string;
    phoneNumberId: string;
    bairro?: string | null;
    itensDescricao?: string | null;
    canal?: PedidoCanalFlow | null;
  }) => Promise<ActiveOrderRecord>;
  updateOrderForFlow: (params: {
    tenantId: string;
    orderId: string;
    status?: "CREATED" | "ROUTED" | "NOTIFIED" | "TIMEOUT" | "CANCELED";
    extraFields?: Record<string, unknown>;
  }) => Promise<void>;
  buildMatchingSnapshot: (params: {
    tenantId: string;
    orderId: string;
    attemptNo: number;
    inputContext: {
      bairro: string;
      bairroNorm: string;
      canal: PedidoCanalFlow;
      intent: IntentName;
      userBotState: NonNullable<UserBotState>;
    };
    excludeDepositoIds?: string[];
  }) => Promise<MatchingSnapshot>;
  forwardOrderToDeposito: (params: {
    tenantId: string;
    phoneNumberId: string;
    orderId: string;
    attemptNo: number;
    selectedDepositoId: string;
    expectedFingerprint: string;
    snapshotVersion: string;
    policyVersion: string;
    policyHash: string;
  }) => Promise<{
    ok: boolean;
    forwardResult: "forwarded" | "failed" | "diverged" | "skipped";
    forwardFailureReason?: string;
    selectedDepositoName?: string;
  }>;
  fetchMatchingRolloutConfig?: (tenantId: string) => Promise<MatchingRolloutConfig | null>;
  findDepositoById?: (params: { tenantId: string; depositoId: string }) => Promise<DepositoRecord | null>;
  getDevTenantStatus?: (params: {
    tenantId: string;
  }) => Promise<{
    tenantId: string;
    depositosOpen: number;
    depositosTotal: number;
    ordersActive: number;
    preCadastrosPending: number;
  }>;
  getDevModeAllowedWaIds?: (tenantId: string) => Promise<string[]>;
  getDevModeAuthState?: (params: {
    tenantId: string;
    waId: string;
  }) => Promise<{
    failedAttempts: number;
    lockUntilMs: number | null;
    lastFailureAtMs: number | null;
    lastSuccessAtMs: number | null;
    updatedAtMs: number;
  } | null>;
  setDevModeAuthState?: (params: {
    tenantId: string;
    waId: string;
    failedAttempts: number;
    lockUntilMs: number | null;
    success?: boolean;
  }) => Promise<void>;
  appendDevModeAuditEvent?: (params: {
    tenantId: string;
    waId: string;
    event: string;
    result: "ok" | "denied" | "failed";
    reason?: string;
    command?: string;
    requestId?: string | null;
  }) => Promise<void>;
  devCreateDeposito?: (params: {
    tenantId: string;
    cnpj: string;
    nome: string;
    wa: string;
    bairro: string;
    cidade: string;
    actorWaId: string;
  }) => Promise<{ depositoId: string; created: boolean }>;
  saveIndicacao?: (params: {
    tenantId: string;
    waId: string;
    bairro: string;
    bairroNorm: string;
    nomeDeposito: string | null;
    telefoneDeposito: string | null;
  }) => Promise<void>;
  transitionUserState?: (params: {
    tenantId: string;
    waId: string | null;
    bsuId?: string | null;
    waUsername?: string | null;
    name?: string | null;
    type: UserType;
    botState: UserBotState;
    botStateExpiresAtMs: number | null;
    conversationHistory?: UserRecord["conversationHistory"];
    activeOrderId?: string | null;
    fallbackCount?: number | null;
    lastActivityAtMs?: number;
    pendingOffers?: any[];
    slots?: UserRecord["slots"] | null;
    lastIntent?: IntentName | null;
    lastIntentConfidence?: number | null;
    bairro?: string | null;
    bairroNorm?: string | null;
    beverageBrand?: string | null;
    beverageVolumeMl?: number | null;
    beveragePackType?: UserRecord["beveragePackType"];
    hasVasilhame?: boolean | null;
    ageConfirmed?: boolean | null;
    paymentMethod?: UserRecord["paymentMethod"];
    expectedBotState?: UserBotState | null;
  }) => Promise<UserRecord | "conflict">;
  acquireProcessingLock?: (params: {
    tenantId: string;
    waId: string;
    messageId: string;
    ttlMs: number;
  }) => Promise<"acquired" | "blocked">;
  releaseProcessingLock?: (params: {
    tenantId: string;
    waId: string;
    messageId: string;
  }) => Promise<void>;
}

export interface FlowMessenger {
  sendText: (params: {
    tenantId: string;
    phoneNumberId: string;
    waId: string;
    body: string;
    stickerName?: string;
    policyEvent?: string;
    buttons?: Array<{ id: string; title: string }>;
    isLocationRequest?: boolean;
    pdfUrl?: string;
  }) => Promise<void>;
  sendContactRequest: (params: {
    tenantId: string;
    phoneNumberId: string;
    waId: string;
    body: string;
  }) => Promise<void>;
  sendList: (params: {
    tenantId: string;
    phoneNumberId: string;
    waId: string;
    body: string;
    buttonLabel: string;
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  }) => Promise<void>;
}
