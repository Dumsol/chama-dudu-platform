export type PreCadastroStatus =
  | "pending_confirmation"
  | "collecting_details"
  | "awaiting_location"
  | "confirmed"
  | "unsupported_region"
  | "abandoned"
  | "failed_delivery"
  | "manual_review";
export type ConfirmationStatus = "pending" | "in_progress" | "confirmed";
export type AtendimentoMode = "retirada" | "entrega" | "ambos";
export type ConfirmationStep =
  | "awaiting_identity_confirmation"
  | "awaiting_bairros"
  | "awaiting_atendimento_mode"
  | "awaiting_horario"
  | "awaiting_location"
  | "completed";

export interface OfficialLocation {
  latitude: number;
  longitude: number;
  address?: string | null;
  name?: string | null;
}

export interface PreCadastroConfirmationData {
  bairrosAtendidos?: string[];
  atendimentoMode?: AtendimentoMode;
  horarioAtendimento?: string;
  officialLocation?: OfficialLocation;
  officialWhatsappConfirmed?: boolean;
}

export interface PreCadastroRecord {
  id: string;
  tenantId: string;
  whatsapp: string;
  status: PreCadastroStatus;
  regionStatus: "supported" | "unsupported";
  confirmationStatus: ConfirmationStatus;
  confirmationStep: ConfirmationStep;
  confirmationData?: PreCadastroConfirmationData;
  templateDispatch?: {
    key?: string;
    status?: "pending" | "sending" | "sent" | "failed";
    templateName?: string;
    languageCode?: string;
    attempts?: number;
    sentAtMs?: number | null;
    lastAttemptAtMs?: number | null;
    lastError?: string | null;
    source?: string | null;
  };
}
