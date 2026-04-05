// FILE: functions/src/core/types.ts
import type * as FirebaseFirestore from "firebase-admin/firestore";

export type UserType = "cliente" | "deposito";

// Canal do pedido
export type PedidoCanal = "DELIVERY" | "RETIRADA" | "CONSULTA";

// ----------------------------
// Máquina principal (macro)
// ----------------------------
export type OrderStatus =
  | "CREATED"
  | "ROUTED"
  | "NOTIFIED"
  | "ACCEPTED"
  | "DECLINED"
  | "TIMEOUT"
  | "CANCELED"
  | "DONE";

// ----------------------------
// Andamento (micro) pós-aceite
// ----------------------------
export type FulfillmentStatus =
  | "NONE"
  | "SEPARANDO"
  | "A_CAMINHO"
  | "ENTREGUE_DEPOSITO"
  | "ENTREGUE_PRESUMIDO"
  | "ENTREGUE_CONFIRMADO";

export type LastActionBy = "cliente" | "deposito" | "system";

export type RiskFlag =
  | "CLIENT_FLOOD"
  | "DEPOSITO_LENTO"
  | "MANY_REROUTES"
  | "LOW_RATING"
  | "COMPLAINT_OPEN";

export type DepositoQualidadeStatus = "OK" | "EM_OBSERVACAO" | "SUSPENSO";

export interface DepositoStatsLast7d {
  notifiedToAcceptAvgMin?: number | null;
  acceptToValorAvgMin?: number | null;
  issueCount?: number | null;
  lowRatingCount?: number | null;
}

export interface DepositoStatsAllTime {
  ratingCount?: number | null;
  ratingSum?: number | null;
  ratingAvg?: number | null;
  lastRating?: number | null;
  lastRatingAt?: FirebaseFirestore.Timestamp | null;

  strikesHard?: number | null;

  issueCountTotal?: number | null;
  lowRatingCountTotal?: number | null;
  timeoutCountTotal?: number | null;
}

export interface Deposito {
  id: string;
  nome: string;
  bairro: string;
  waId: string;

  status: "ABERTO" | "FECHADO";

  deliveryDisponivel: boolean;
  retiradaDisponivel: boolean;

  endereco?: string | null;
  horarioFuncionamento?: string | null;
  horarioAbertura?: string | null;
  horarioFechamento?: string | null;
  timezone?: string | null;

  // --- ROI routing / operação ---
  routeEligible?: boolean;
  pausedUntilMs?: number | null;
  pauseReason?: string | null;
  lastSeenAtMs?: number | null;
  lastRoutedAtMs?: number | null;
  lastInboundAtMs?: number | null;
  lastAckAtMs?: number | null;
  operational?: {
    offlineUntilMs?: number | null;
    lastEmergencyHelpAt?: FirebaseFirestore.Timestamp | null;
    updatedAt?: FirebaseFirestore.Timestamp | null;
  };

  billing?: {
    status: "OK" | "INADIMPLENTE";
    cycleId?: string | null;
    paymentUrl?: string | null;
    reason?: string | null;
    blockedAt?: FirebaseFirestore.Timestamp | null;
    updatedAt?: FirebaseFirestore.Timestamp | null;
  };

  quality?: {
    statusQualidade: DepositoQualidadeStatus;
    strikes7d?: number | null;
    updatedAt?: FirebaseFirestore.Timestamp | null;
    reason?: string | null;
  };

  stats?: {
    last7d?: DepositoStatsLast7d;
    allTime?: DepositoStatsAllTime;
    updatedAt?: FirebaseFirestore.Timestamp | null;
  };
}

export interface Order {
  id: string;
  tenantId: string;

  userId: string;
  phoneNumberId: string;

  // Identificadores públicos (para UX do cliente)
  publicSeq?: number | null;
  publicCode?: string | null;
  publicHash?: string | null;
  publicWaId?: string | null;
  publicClientName?: string | null;

  bairro?: string | null;
  itensDescricao?: string | null;
  canal?: PedidoCanal | null;

  depositoId?: string | null;

  enderecoEntrega?: string | null;
  cepEntrega?: string | null;
  referenciaEntrega?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  enderecoConfirmado?: boolean | null;

  tentativasDepositos?: string[];

  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;

  valorTotalPedido?: number | null;
  valorSourceText?: string | null;
  valorPropostoAt?: FirebaseFirestore.Timestamp | null;
  valorConfirmadoAt?: FirebaseFirestore.Timestamp | null;
  valorRejeitadoAt?: FirebaseFirestore.Timestamp | null;

  pricing?: {
    subtotal?: number | null;
    serviceFee?: number | null;
    totalToCollect?: number | null;
  };
  promoBenefitApplied?: {
    kind: "SERVICE_FEE_WAIVER";
    amountCents: number;
    discountCents: number;
    appliedAt?: FirebaseFirestore.Timestamp | null;
    appliedAtMs?: number | null;
  } | null;
  platformFeeSnapshot?: number | null;

  // ETA (previsão)
  etaMin?: number | null;
  etaSourceText?: string | null;
  etaSetAt?: FirebaseFirestore.Timestamp | null;

  lastActionBy?: LastActionBy | null;
  lastActionAt?: FirebaseFirestore.Timestamp | null;
  lastActionTextPreview?: string | null;

  riskFlags?: RiskFlag[];
  complaintOpen?: boolean;
  missingItemsReported?: boolean;
  evidenceRequested?: boolean;

  feedbackNota?: number | null;
  feedbackAt?: FirebaseFirestore.Timestamp | null;

  issueOpenId?: string | null;

  reminders?: {
    acceptedNoValorPingAt?: FirebaseFirestore.Timestamp | null;
    clientNoConfirmPingAt?: FirebaseFirestore.Timestamp | null;
    presumidoNotifiedAt?: FirebaseFirestore.Timestamp | null;
    issuePingAt?: FirebaseFirestore.Timestamp | null;
    aCaminhoPingAt?: FirebaseFirestore.Timestamp | null;
    abandonedNudgeAt?: FirebaseFirestore.Timestamp | null;

    // Confirmação pós-"entregue" do depósito (ping 0/5/13 min)
    deliveredConfirmButtonsSentAt?: FirebaseFirestore.Timestamp | null;
    deliveredConfirmPing5At?: FirebaseFirestore.Timestamp | null;
    deliveredConfirmPing13At?: FirebaseFirestore.Timestamp | null;
  };

  deliveredByClienteAt?: FirebaseFirestore.Timestamp | null;
  deliveredByDepositoAt?: FirebaseFirestore.Timestamp | null;
  deliveredPresumidoAt?: FirebaseFirestore.Timestamp | null;
  deliveredAt?: FirebaseFirestore.Timestamp | null;

  printKey?: string | null;

  promoDiscountCandidate?: {
    enabledByDeposito: boolean;
    productName: string;
    percentOff: number;
    maxDiscountCentavos: number;
    windowStart?: FirebaseFirestore.Timestamp | null;
    windowEnd?: FirebaseFirestore.Timestamp | null;
    notes?: string | null;
  } | null;
  promoHistoryRecordedAt?: FirebaseFirestore.Timestamp | null;

  notifyLog?: Record<string, FirebaseFirestore.Timestamp | null> | null;
  actionLog?: Record<string, FirebaseFirestore.Timestamp | null> | null;

  addressChangeCount?: number | null;
  itemAddCount?: number | null;
  itemAddLastText?: string | null;

  clientDepositoAnnouncedId?: string | null;
  clientDepositoAnnouncedAt?: FirebaseFirestore.Timestamp | null;

  createdAt?: FirebaseFirestore.Timestamp | null;
  updatedAt?: FirebaseFirestore.Timestamp | null;
  routedAt?: FirebaseFirestore.Timestamp | null;
  notifiedAt?: FirebaseFirestore.Timestamp | null;
  acceptedAt?: FirebaseFirestore.Timestamp | null;
  declinedAt?: FirebaseFirestore.Timestamp | null;
  timeoutAt?: FirebaseFirestore.Timestamp | null;
  canceledAt?: FirebaseFirestore.Timestamp | null;
  doneAt?: FirebaseFirestore.Timestamp | null;
}
