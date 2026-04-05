import * as logger from "firebase-functions/logger";
import { UserBotState, UserRecord, WhatsAppInboundMessage, BotResponse } from "./types";
import { opsRepositories } from "../../infra/firestore/opsRepositories";
import { tenantConfigDoc } from "../../infra/firestore/duduPaths";
import { readDevToken } from "../../infra/config/secrets";
import { promptBuilder } from "./promptBuilder";
import { queryRAG, RAG_NO_RESULT_FOUND } from "../../infra/ai/vertexAiService";
import { resolveGPS } from "../../infra/whatsapp/gpsResolver";
import { listarDepositosAbertosPorBairro } from "../../modules/depositos/depositoService";
import { parseDevCommand, composeDevHelpMessage } from "./devMode";
import { parseAgentPayload, extractResponseText } from "../../infra/ai/agentPayloadParser";
import {
  resolveButtonAction,
  buildAgeGateButtons,
  buildBairroConfirmButtons,
  buildLocationRequestMessage,
  buildBeveragePackagingButtons,
  buildMainMenuButtons,
  buildDeliveryAddressRequest,
  buildOrderConfirmButtons,
  buildPaymentMethodButtons,
  buildDuplicateOrderButtons,
  buildVasilhameButtons,
  buildDevPanelMainMenu,
  buildDevOrdersListResponse,
  buildDevStuckOrdersResponse,
} from "./whatsappButtons";
import { resolveBeverage, buildClarificationQuestion } from "./beverageResolver";

// I have no idea why we have so many entities. My head hurts.
interface ExtractedEntities {
  bairroNorm?: string | null;
  bairro?: string | null;
  beverage?: string | null;        // texto bruto (fallback)
  beverageBrand?: string | null;
  beverageVolumeMl?: number | null;
  beveragePackType?: UserRecord["beveragePackType"];
  hasVasilhame?: boolean | null;
  ageConfirmed?: boolean | null;
  paymentMethod?: UserRecord["paymentMethod"];
}

const FRESH_SESSION_WINDOW_MS = 30 * 60 * 1000;
const NEIGHBORHOOD_PROMPT_REGEX = /\b(bairro|localiza(?:c|ç)(?:a|ã)o|endere(?:c|ç)o)\b/i;

function isFreshSession(user: UserRecord): boolean {
  const lastActivityAtMs = Number(user.lastActivityAtMs ?? 0);
  if (!Number.isFinite(lastActivityAtMs) || lastActivityAtMs <= 0) return false;
  return Date.now() - lastActivityAtMs <= FRESH_SESSION_WINDOW_MS;
}

function isAddressChangeIntent(inputText: string): boolean {
  const normalized = inputText.toLowerCase();
  return (
    /\b(mudei|mudou|trocar|troquei|novo bairro|outro bairro|agora (?:é|eh|e) em)\b/.test(normalized) ||
    /\b(entrega|entregar)\s+(?:agora\s+)?(?:em|no|na)\b/.test(normalized) ||
    /\b(endere(?:c|ç)o)\s+(?:novo|mudou)\b/.test(normalized)
  );
}

function shouldBlockNeighborhoodRegression(params: {
  user: UserRecord;
  entities: ExtractedEntities;
  candidateState: UserBotState;
  inputText: string;
}): boolean {
  const { user, entities, candidateState, inputText } = params;
  const hasConfirmedNeighborhood = Boolean(user.bairroNorm || entities.bairroNorm);
  const hasActiveSession = Boolean(hasConfirmedNeighborhood || user.activeOrderId);
  if (!hasActiveSession) return false;

  if (candidateState === "idle") return true;
  if (candidateState !== "awaiting_neighborhood") return false;

  if (!isFreshSession(user)) return false;
  if (isAddressChangeIntent(inputText)) return false;
  return true;
}

/**
 * State Machine (FSM v3) - This is where the magic (and my nightmares) happens.
 * Please don't touch this unless you have a PhD in patience.
 */
export const stateEngine = {
  async processInboundMessage(params: {
    tenantId: string;
    waId: string;
    /** Mensagem completa parseada pelo parser.ts — inclui sourceKind, interactiveId, location */
    message: WhatsAppInboundMessage;
  }): Promise<BotResponse> {
    const { tenantId, waId, message } = params;
    const { sourceKind, interactiveId, location, text, waUsername, profileName, bsuId } = message;

    // --- 1. Find or create user (or just give up) --------------------------
    const existing = await opsRepositories.getUserByTenantWaId(tenantId, waId);
    let user: UserRecord;

    if (!existing) {
      user = await opsRepositories.upsertUser({
        tenantId,
        waId: message.waId ?? null,
        bsuId,
        waUsername,
        name: waUsername || profileName || "Cliente",
        type: "cliente",
        botState: "idle",
        conversationHistory: [],
      });
    } else {
      user = {
        ...existing,
        bsuId: existing.bsuId ?? bsuId ?? undefined,
        waUsername: existing.waUsername ?? waUsername ?? undefined,
        name: existing.name ?? waUsername ?? profileName ?? undefined,
      };
    }

    // --- 1b. Maintenance mode (The only time I can actually sleep) --------
    // Lê config do tenant para ver se o bot está em manutenção.
    // Em manutenção: responde com mensagem de indisponibilidade e para.
    const configSnap = await tenantConfigDoc(tenantId).get().catch(() => null);
    const tenantConfig = (configSnap?.data?.() ?? {}) as Record<string, any>;
    if (tenantConfig.maintenanceMode?.enabled) {
      const msg = String(tenantConfig.maintenanceMode.message ?? "Estamos em manutenção. Voltamos em breve! 🔧");
      return { body: msg };
    }

    // ── 1c. Reset de Inatividade (30 min) ──────────────────────────────────
    // Se o usuário ficou inativo por > 30 min, limpamos o ID do pedido ativo
    // e o estado para que ele comece do zero (sem afetar o Firestore do depósito).
    const nowMs = Date.now();
    const isStale = (user.lastActivityAtMs ?? 0) > 0 && nowMs - (user.lastActivityAtMs ?? 0) > FRESH_SESSION_WINDOW_MS;
    
    if (isStale && user.activeOrderId) {
      logger.info("[SESSION_RESET] Clearing stale active order", { waId, lastActivity: user.lastActivityAtMs });
      user.activeOrderId = null;
      user.botState = "idle";
      // Manter bairroNorm para conveniência, mas resetar o fluxo.
    }

    // ── 1d. Intercept de Pedido Duplicado ──────────────────────────────────
    // Se o usuário já tem um pedido ativo e tenta fazer um novo ("quero...", "pedir..."),
    // interceptamos com botões de decisão antes de chamar a IA.
    const textLower = (text || "").toLowerCase();
    const isNewOrderIntent = /\b(quero|pedir|manda|me manda|bebida|cerveja|agua|água|skol|heineken|brahma)\b/i.test(textLower);
    
    if (user.activeOrderId && isNewOrderIntent && user.botState !== "awaiting_delivery_address") {
      logger.info("[DUPLICATE_ORDER_INTERCEPT] Active order detected", { waId, activeOrderId: user.activeOrderId });
      const duplicateMsg = buildDuplicateOrderButtons();
      
      await opsRepositories.upsertUser({
        tenantId,
        waId,
        lastActivityAtMs: nowMs,
        type: user.type,
        botState: user.botState,
        conversationHistory: [
          ...(user.conversationHistory ?? []),
          { role: "user" as const, content: text || "[Intent: New Order]", timestampMs: nowMs },
          { role: "model" as const, content: duplicateMsg.body, timestampMs: nowMs },
        ].slice(-20),
      });

      return {
        ...duplicateMsg,
        _nextState: user.botState, // Mantém onde estava
      } as any;
    }

    // ── 1e. Comando DEV (Programmatic / Pure API) ───────────────────────
    const rawText = text?.trim() ?? "";
    const lowerText = rawText.toLowerCase();
    const isDevPrefix = lowerText.startsWith("dev ");

    if (lowerText === "dev" || isDevPrefix) {
      if (isDevPrefix && rawText.length > 4) {
        // "dev <command>" — Processa programaticamente via função interna (Pure API)
        const cmd = parseDevCommand({ normalizedText: lowerText, rawText });

        if (cmd.kind === "help") {
          const msg = composeDevHelpMessage();
          await persistStateUpdate({ tenantId, waId, user, responseText: msg, inputText: rawText, nextState: user.botState });
          return { body: msg };
        }

        if (cmd.kind === "exit") {
          await persistStateUpdate({ tenantId, waId, user, responseText: "🚪 Saindo do modo dev.", inputText: rawText, nextState: "idle" });
          return { body: "🚪 Modo Dev desativado. Voltando ao fluxo normal." };
        }

        if (cmd.kind === "tenant_status") {
          const status = `📊 *Status do Sistema*\n\n• Tenant: ${tenantId}\n• Região: us-south1\n• Manutenção: ${tenantConfig.maintenanceMode?.enabled ? "ATIVADA 🔴" : "DESATIVADA 🟢"}`;
          await persistStateUpdate({ tenantId, waId, user, responseText: status, inputText: rawText, nextState: user.botState });
          return { body: status };
        }

        // Se o comando for desconhecido (e não for tentativa de senha), mostra Ajuda
        if (cmd.kind === "unknown" && user.botState !== "dev_mode") {
          const msg = "⚠️ Comando dev não reconhecido.\n\n" + composeDevHelpMessage();
          await persistStateUpdate({ tenantId, waId, user, responseText: msg, inputText: rawText, nextState: user.botState });
          return { body: msg };
        }
      }

      // Caso base: apenas "dev" -> pede senha
      if (lowerText === "dev" && user.botState !== "dev_mode") {
        await persistStateUpdate({
          tenantId, waId, user,
          responseText: "🔐 Painel Dev — informe a senha:",
          inputText: "dev",
          nextState: "dev_mode",
        });
        return { body: "🔐 *Painel Dev* — informe a senha de acesso:" };
      }
    }

    if (user.botState === "dev_mode") {
      // Verifica se é a senha
      let devToken = "";
      try { devToken = readDevToken(); } catch { /* ignora */ }
      const isValid = devToken && rawText === devToken;

      if (isValid) {
        // Senha correta → mostra painel com botões
        await persistStateUpdate({
          tenantId, waId, user,
          responseText: "✅ Acesso autorizado. Painel Dev aberto.",
          inputText: rawText,
          nextState: "dev_mode",
        });
        return buildDevPanelMainMenu();
      }

      // Não é a senha — verifica se manutenção está ativa e o texto é uma mensagem de manutenção
      const maintenanceActive = tenantConfig.maintenanceMode?.enabled;
      if (maintenanceActive && rawText.length > 4) {
        // Atualiza mensagem de manutenção
        await tenantConfigDoc(tenantId).set(
          { maintenanceMode: { message: rawText, updatedAt: Date.now() } },
          { merge: true }
        );
        const responseBody = `✅ Mensagem de manutenção atualizada:\n_"${rawText}"_`;
        await persistStateUpdate({ tenantId, waId, user, responseText: responseBody, inputText: rawText, nextState: "dev_mode" });
        return { body: responseBody };
      }

      // Caso especial: usuário está em dev_mode depois de clicar "Ver pedidos" → esperando bairro
      if (rawText && (rawText.toLowerCase() === "todos" || rawText.length > 2)) {
        // Filtro por bairro ou "todos"
        try {
          const bairroFilter = rawText.toLowerCase() === "todos" ? null : rawText;
          // Query pedidos ativos — placeholder
          const summary = bairroFilter
            ? `📋 *Pedidos em ${rawText}*:\n\n(carregando...)`
            : `📋 *Todos os pedidos*:\n\n(carregando...)`;
          const responseBody = summary;
          await persistStateUpdate({ tenantId, waId, user, responseText: responseBody, inputText: rawText, nextState: "dev_mode" });
          return { body: responseBody };
        } catch {
          const responseBody = "❌ Erro ao carregar pedidos.";
          await persistStateUpdate({ tenantId, waId, user, responseText: responseBody, inputText: rawText, nextState: "dev_mode" });
          return { body: responseBody };
        }
      }

      // Senha errada → volta para idle
      await persistStateUpdate({
        tenantId, waId, user,
        responseText: "❌ Senha incorreta.",
        inputText: rawText,
        nextState: "idle",
      });
      return { body: "❌ Senha incorreta. Painel fechado." };
    }

    // --- 2. Fast track for buttons (because LLM is too slow and expensive)
    // Botões deterministas não precisam consultar o corpus — a resposta é
    // derivada diretamente da ação semântica + estado atual.
    if (sourceKind === "interactive" || sourceKind === "button") {
      const buttonId = interactiveId ?? "";
      const action = resolveButtonAction(buttonId);

      // ── Botões do painel dev ───────────────────────────────────────────
      if (action === "dev_maintenance_on" || action === "dev_maintenance_off" || action === "dev_orders_list" || action === "dev_depositos_status" || action === "dev_stuck_orders" || action === "dev_exit") {
        let responseBody = "";
        let nextState: UserBotState = "dev_mode";

        if (action === "dev_exit") {
          responseBody = "🚪 Painel Dev fechado.";
          nextState = "idle";
        } else if (action === "dev_maintenance_on") {
          await tenantConfigDoc(tenantId).set(
            { maintenanceMode: { enabled: true, message: "Estamos em manutenção. Volte em breve! 🔧", updatedAt: Date.now() } },
            { merge: true }
          );
          responseBody = "🔴 *Manutenção ATIVADA.* Envie a mensagem de manutenção (ex: \"Manutenção prevista até 23h\") ou deixe o padrão.";
        } else if (action === "dev_maintenance_off") {
          await tenantConfigDoc(tenantId).set(
            { maintenanceMode: { enabled: false, updatedAt: Date.now() } },
            { merge: true }
          );
          responseBody = "🟢 *Manutenção DESATIVADA.* Bot voltou ao normal.";
        } else if (action === "dev_orders_list") {
          responseBody = buildDevOrdersListResponse().body;
        } else if (action === "dev_depositos_status") {
          responseBody = `🏪 *Status de Depósitos*\n\n(carregando status...)`;
        } else if (action === "dev_stuck_orders") {
          responseBody = buildDevStuckOrdersResponse().body;
        }

        await persistStateUpdate({ tenantId, waId, user, responseText: responseBody, inputText: buttonId, nextState });
        return { body: responseBody };
      }

      const fastResponse = await handleButtonAction({
        action,
        buttonId,
        user,
        tenantId,
        waId,
      });

      if (fastResponse) {
        // Persiste o estado resultante da ação do botão.
        // Passa _entities do response para preservar bairroNorm/beverage
        // (crítico para gps_confirmed não zerar o bairro).
        await persistStateUpdate({
          tenantId,
          waId,
          user,
          responseText: fastResponse.body,
          inputText: interactiveId ?? "button_click",
          nextState: fastResponse._nextState,
          entities: fastResponse._entities,
        });
        return fastResponse;
      }
      // Se não houver tratamento rápido, cai no RAG abaixo.
    }

    // ── 3. Resolução de localização GPS ────────────────────────────────────
    if (sourceKind === "location" && location) {
      const gpsResponse = await handleLocationMessage({
        location,
        user,
        tenantId,
        waId,
      });
      // CRÍTICO: passar _entities para que bairroNorm seja salvo no Firestore
      // agora, neste turno — não aguardar a confirmação do botão.
      await persistStateUpdate({
        tenantId,
        waId,
        user,
        responseText: gpsResponse.body,
        inputText: `GPS lat=${location.latitude},lng=${location.longitude}`,
        nextState: gpsResponse._nextState,
        entities: gpsResponse._entities,
      });
      return gpsResponse;
    }

    // ── INTERCEPT FSM FOR DEPOSITO SIGNUP (bypass RAG) ────────
    if (user.botState.startsWith("deposito_signup_") ||
      /(?:quero\s+ser|abrir|cadastrar|novo)\s*(?:um\s+)?dep[oó]sito/i.test(text || "")) {

      const isStart = !user.botState.startsWith("deposito_signup_");

      // Se está iniciando o fluxo, primeiro oferecer o site
      if (isStart && user.botState !== "deposito_signup_site_offered") {
        const siteResponse: BotResponseWithState = {
          body: "Oi chefe! 👋 Para se cadastrar como depósito parceiro, o jeito mais rápido é pelo nosso site:\n\n👉 *chamadudu.web.app*\n\nÉ rapidinho, leva menos de 2 minutinhos. Se tiver dificuldade, é só me falar que eu faço por aqui mesmo! 🤙",
          _nextState: "deposito_signup_site_offered" as any,
        };
        await persistStateUpdate({
          tenantId, waId, user,
          responseText: siteResponse.body,
          inputText: text || "",
          nextState: "deposito_signup_site_offered" as any,
        });
        return siteResponse;
      }

      // Se estado é "deposito_signup_site_offered", checar se quer prosseguir pelo bot
      if ((user.botState as string) === "deposito_signup_site_offered") {
        const wantsBotFlow = /n[aã]o|n consegui|pelo (bot|whatsapp|zap)|aqui|por aqui/i.test(text || "");
        if (!wantsBotFlow) {
          // Ainda não confirmou que quer pelo bot — manter estado
          const waitResponse: BotResponseWithState = {
            body: "Conseguiu acessar o site? 😊 Se não conseguir, é só me falar que a gente faz por aqui!",
            _nextState: "deposito_signup_site_offered" as any,
          };
          await persistStateUpdate({ tenantId, waId, user, responseText: waitResponse.body, inputText: text || "", nextState: "deposito_signup_site_offered" as any });
          return waitResponse;
        }
        // Quer fazer pelo bot — inicia o fluxo
      }

      const pseudoState = (user.botState.startsWith("deposito_signup_") && user.botState !== "deposito_signup_site_offered")
        ? user.botState
        : "deposito_signup_start";

      // Para cliques de botão no fluxo deposito (ex: signup_frota_yes),
      // o inputText deve incluir o interactiveId para detecção correta.
      const depositoInputText = interactiveId ? (interactiveId + " " + (text || "")).trim() : (text || "");

      const fastResponse = resolveResponseForState({
        currentState: pseudoState as any,
        ragAnswer: "",
        inputText: depositoInputText,
        user
      });

      await persistStateUpdate({
        tenantId,
        waId,
        user,
        responseText: fastResponse.body,
        inputText: depositoInputText,
        nextState: fastResponse._nextState,
        entities: fastResponse._entities as any,
      });

      return fastResponse;
    }

    // ── 3c. Fast-Track: Ignorar IA para estados deterministicos ───────────
    // Se o usuário está em um estado que resolve por botões/lógica local 
    // (ex: vasilhame, pagamento), tentamos resolver antes de chamar a IA lenta.
    const DETERMINISTIC_STATES: UserBotState[] = [
      "awaiting_vasilhame",
      "payment_method",
      "awaiting_beverage_clarification",
      "bairro_confirmation",
    ];

    if (DETERMINISTIC_STATES.includes(user.botState)) {
      const fastResponse = resolveResponseForState({
        currentState: user.botState,
        ragAnswer: "[[DETERMINISTIC_BYPASS]]",
        inputText: text || interactiveId || "",
        user,
      });

      // Se a resposta não contém a tag de bypass no corpo, significa que a lógica
      // local encontrou uma solução (botão clicado ou regex deu match).
      if (!fastResponse.body.includes("[[DETERMINISTIC_BYPASS]]")) {
        logger.info("[FAST_TRACK] Skipping AI for deterministic state", {
          waId,
          state: user.botState,
        });

        await persistStateUpdate({
          tenantId,
          waId,
          user,
          responseText: fastResponse.body,
          inputText: text || interactiveId || "",
          nextState: fastResponse._nextState,
          entities: fastResponse._entities as any,
        });

        return fastResponse;
      }
    }

    // ── 4. Grounded Generation via RAG (mensagens de texto + fallback) ─────
    const promptContext = promptBuilder.buildUserPrompt({
      user,
      message: {
        text,
        sourceKind,
        interactiveId: interactiveId ?? null,
        interactiveTitle:
          (message as WhatsAppInboundMessage & {
            interactiveTitle?: string | null;
          }).interactiveTitle ?? null,
        location: location ?? null,
      },
    });

    // Logging internal state for debugging
    logger.info("[StateEngine] Prompt construction complete", {
      waId,
      botState: user.botState,
      bairroNorm: user.bairroNorm,
      hasBairro: !!user.bairroNorm,
    });

    // Antes de chamar o RAG, envia mensagem intermediária se a geração demorar
    // (a mensagem interimMessage é tratada pelo processor.ts)
    const ragResult = await queryRAG(
      promptContext.effectiveQuery,
      user.botState,
      {
        conversationHistory: promptContext.history,
        systemInstruction: promptContext.systemInstruction,
        sessionId: `${tenantId}:${waId}`,
      },
    );

    // ── 5. Fallback de infraestrutura — não avançar estado, tentar Pure API se houver bairro
    if (ragResult._fallbackBotState !== undefined || ragResult.answer === RAG_NO_RESULT_FOUND) {
      const fallbackResponse = await executeManualSearchFallback({ tenantId, waId, user });
      
      await persistStateUpdate({
        tenantId,
        waId,
        user,
        responseText: fallbackResponse.body,
        inputText: promptContext.normalizedText,
        nextState: fallbackResponse._nextState || user.botState,
      });

      return fallbackResponse;
    }

    // ── 6. Parse do Payload Estruturado (<json>) ──────────────────────────
    const agentPayload = parseAgentPayload(ragResult.answer);
    let responseText =
      agentPayload?.responseText ?? extractResponseText(ragResult.answer);

    // FIX: Se o LLM mandou apenas JSON e o responseText ficou vazio, 
    // usamos um fallback humano para não enviar nada técnico ao cliente.
    if (!responseText || responseText.trim().length === 0) {
      logger.info("[StateEngine] LLM responseText was empty. Using human fallback.", { 
        waId: user.waId, 
        currentState: user.botState 
      });
      
      switch (user.botState) {
        case "awaiting_checkout":
          responseText = "Tudo certo! Podemos fechar o pedido?";
          break;
        case "payment_method":
          responseText = "Como prefere pagar?";
          break;
        case "awaiting_product":
          responseText = "Pode me confirmar o que vai querer hoje? 🍻";
          break;
        default:
          responseText = "Como podemos seguir com seu pedido? 🍺";
      }
    }

    const modelIntent =
      typeof agentPayload?.intent === "string" && agentPayload.intent.trim()
        ? (agentPayload.intent.trim() as any)
        : undefined;
    const rawIntentConfidence = (agentPayload as { intentConfidence?: unknown } | null)?.intentConfidence;
    const modelIntentConfidence =
      typeof rawIntentConfidence === "number" && Number.isFinite(rawIntentConfidence)
        ? rawIntentConfidence
        : undefined;

    // ── 6a. Extrair entidades do payload para persistência ─────────────────
    const entities: ExtractedEntities = {};
    if (agentPayload?.effectiveEntities) {
      const ents = agentPayload.effectiveEntities;
      if (typeof ents.bairroNorm === "string" && ents.bairroNorm) {
        entities.bairroNorm = ents.bairroNorm;
      }
      if (typeof ents.bairro === "string" && ents.bairro) {
        entities.bairro = ents.bairro;
      }
      // beverage bruto (fallback para quando o LLM não desagregou ainda)
      if (typeof ents.beverage === "string" && ents.beverage) {
        entities.beverage = ents.beverage;
      }
      // Campos de produto desagregados (são os que o contrato do sistema prompt produz)
      if (typeof ents.beverageBrand === "string" && ents.beverageBrand) {
        entities.beverageBrand = ents.beverageBrand;
      }
      if (typeof ents.beverageVolumeMl === "number") {
        entities.beverageVolumeMl = ents.beverageVolumeMl;
      }
      if (
        typeof ents.beveragePackType === "string" &&
        ["lata", "long_neck", "garrafa", "pack", "litrão"].includes(ents.beveragePackType as string)
      ) {
        entities.beveragePackType = ents.beveragePackType as UserRecord["beveragePackType"];
      }
      if (typeof ents.hasVasilhame === "boolean") {
        entities.hasVasilhame = ents.hasVasilhame;
      }
      if (typeof ents.ageConfirmed === "boolean") {
        entities.ageConfirmed = ents.ageConfirmed;
      }
      if (
        typeof ents.paymentMethod === "string" &&
        ["pix", "cartao", "dinheiro"].includes(ents.paymentMethod as string)
      ) {
        entities.paymentMethod = ents.paymentMethod as UserRecord["paymentMethod"];
      }
    }

    if (!responseText) {
      // Fallback F06 — nunca deixar sem resposta para o usuário
      const fallbackBody =
        "Eita, deu um probleminha aqui. Tenta de novo em 1 minutinho!";
      logger.error("AGENT_PAYLOAD_PARSE_FAIL", {
        rawResponse: ragResult.answer.slice(0, 500),
      });

      await persistStateUpdate({
        tenantId,
        waId,
        user,
        responseText: fallbackBody,
        inputText: promptContext.normalizedText,
        nextState: user.botState, // Mantém o estado
        entities,
        lastIntent: modelIntent,
        lastIntentConfidence: modelIntentConfidence,
      });

      return { body: fallbackBody };
    }

    // ── 7. Determinar próximo estado + botões contextuais ──────────────────
    // A lógica de switch usa SEMPRE o estado atual do usuário (user.botState).
    // O nextBotState do LLM serve como candidato para override, mas nunca pode
    // regredir o fluxo (ex: LLM sugere "idle" quando bairro já foi confirmado).
    const nextResponse = resolveResponseForState({
      currentState: user.botState,
      ragAnswer: responseText,
      inputText: promptContext.normalizedText,
      user,
    });

    // Override de estado: usa nextBotState do LLM apenas quando é um avanço legítimo.
    // Bloqueia regressão para "idle" e, em sessão fresca, bloqueia regressão para
    // "awaiting_neighborhood" quando bairro já estava confirmado sem pedido explícito de troca.
    const llmNextState = agentPayload?.nextBotState as UserBotState | undefined;
    const isLlmRegression = !!(
      llmNextState &&
      shouldBlockNeighborhoodRegression({
        user,
        entities,
        candidateState: llmNextState,
        inputText: promptContext.normalizedText,
      })
    );
    const hasDeterministicEntities = !!(
      nextResponse._entities &&
      Object.keys(nextResponse._entities).length > 0
    );
    const shouldLockDeterministicState =
      hasDeterministicEntities ||
      ["awaiting_beverage_clarification", "awaiting_vasilhame", "payment_method"].includes(
        String(nextResponse._nextState ?? ""),
      );
    const allowStaleNeighborhoodReset =
      llmNextState === "awaiting_neighborhood" && !isFreshSession(user);

    if (
      llmNextState &&
      !isLlmRegression &&
      (!shouldLockDeterministicState || llmNextState === nextResponse._nextState || allowStaleNeighborhoodReset)
    ) {
      nextResponse._nextState = llmNextState;
    }

    if (
      user.bairroNorm &&
      nextResponse._nextState === "awaiting_neighborhood" &&
      isFreshSession(user) &&
      !isAddressChangeIntent(promptContext.normalizedText)
    ) {
      nextResponse._nextState = "awaiting_product";
      if (NEIGHBORHOOD_PROMPT_REGEX.test(nextResponse.body)) {
        nextResponse.body = "Bairro já confirmado, mermão. Agora me diz o que você quer pedir. 🛒";
      }
    }

    // ── 8. Persistir estado, histórico e entidades ─────────────────────────
    const effectiveEntities: ExtractedEntities = {
      ...entities,
      ...(nextResponse._entities ?? {}),
    };

    await persistStateUpdate({
      tenantId,
      waId,
      user,
      responseText,
      inputText: promptContext.normalizedText,
      nextState: nextResponse._nextState,
      entities: effectiveEntities,
      lastIntent: modelIntent,
      lastIntentConfidence: modelIntentConfidence,
    });

    logger.info("[StateEngine] turn complete", {
      waId,
      nextState: nextResponse._nextState,
      bairroNorm: effectiveEntities.bairroNorm ?? (user as any).bairroNorm ?? null,
      beverage: effectiveEntities.beverage ?? (user as any).beverage ?? null,
    });

    return nextResponse;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

type BotResponseWithState = BotResponse & {
  _nextState?: UserBotState;
  /** Entidades resolvidas neste turno — encaminhadas ao persistStateUpdate */
  _entities?: ExtractedEntities;
};

/**
 * Resolve ação determinista para clique de botão.
 * Retorna null se a ação deve ser tratada pelo RAG (ex: "unknown").
 */
async function handleButtonAction(params: {
  action: ReturnType<typeof resolveButtonAction>;
  buttonId: string;
  user: UserRecord;
  tenantId: string;
  waId: string;
}): Promise<BotResponseWithState | null> {
  const { action, user } = params;

  switch (action) {
    // ── Gate de maioridade ────────────────────────────────────────────────
    case "age_confirmed":
      return {
        body:
          "✅ Confirmado! Qual produto você quer pedir?\n\nEx: _'1 Skol gelada 600ml'_, _'2 Heineken lata'_...",
        _nextState: "awaiting_product",
        _entities: { ageConfirmed: true } as any,
      };
    case "age_rejected":
      return {
        body:
          "Tudo bem! Infelizmente só podemos vender bebidas alcoólicas para maiores de 18 anos. 🙏\nPosso ajudar com outra coisa?",
        _nextState: "idle",
        _entities: { ageConfirmed: false } as any,
      };

    // ── Confirmação de pedido ─────────────────────────────────────────────
    case "order_confirmed":
      return {
        ...buildDeliveryAddressRequest(),
        _nextState: "awaiting_delivery_address",
      };
    case "order_rejected":
      return {
        body:
          "Sem problema! O que você quer mudar?\n\nDiga o produto, quantidade ou qualquer detalhe. 🛒",
        _nextState: "awaiting_product",
      };

    // ── Pedido duplicado ──────────────────────────────────────────────────
    case "duplicate_confirmed":
      return {
        body: "Ok! Vou cancelar o pedido atual. Pode fazer seu novo pedido agora. 🔄",
        _nextState: "idle",
      };
    case "duplicate_rejected":
      return {
        body:
          "Perfeito! Seu pedido atual ainda está ativo. 📦\n\nDigite *meu pedido* para ver o status.",
        _nextState: user.botState,
      };

    case "vasilhame_confirmed":
      return {
        ...buildLocationRequestMessage("entrega"),
        body: "✅ Perfeito! E qual o endereço para entrega? 🏠\n" + buildLocationRequestMessage("entrega").body,
        _nextState: "awaiting_delivery_address",
        _entities: { hasVasilhame: true } as any,
      };
    case "vasilhame_rejected":
      return {
        body: "Sem problema! Vou buscar opções em garrafa 600ml ou lata. Qual você prefere? 🍺",
        _nextState: "awaiting_beverage_clarification",
        _entities: { hasVasilhame: false } as any,
      };

    case "gps_confirmed":
      // Ao confirmar, relê bairroNorm do user (salvo no turno do GPS)
      // e propaga via _entities para que persistStateUpdate não zerere o campo.
      // Adição: Garantia de que não salvaremos null se o campo existir no usuário.
      const finalBairroNorm = user.bairroNorm || (user as any).slots?.neighborhood || null;
      const finalBairro = (user as any).bairro || (user as any).slots?.bairro || null;
      
      return {
        body:
          `✅ Ótimo! Bairro confirmado.\n` +
          `Agora me diz o que você quer pedir! 🛒\n\nEx: _'1 Skol gelada 600ml'_`,
        _nextState: "awaiting_product",
        _entities: {
          bairroNorm: finalBairroNorm,
          bairro: finalBairro,
        },
      };
    case "gps_rejected":
      return {
        body:
          "Sem problema! Me diga seu bairro por mensagem:\n\nEx: _Janga_, _Paulista Centro_, _Maria Farinha_...",
        _nextState: "awaiting_neighborhood",
      };

    // ── Forma de pagamento ────────────────────────────────────────────────
    case "payment_pix":
    case "payment_cartao":
    case "payment_dinheiro": {
      const methodMap: Record<string, NonNullable<UserRecord["paymentMethod"]>> = {
        payment_pix: "pix",
        payment_cartao: "cartao",
        payment_dinheiro: "dinheiro",
      };
      const method = methodMap[action];
      const labels = { pix: "PIX 💚", cartao: "Cartão 💳", dinheiro: "Dinheiro 💵" };
      return {
        ...buildOrderConfirmButtons({
          productSummary: user.beverageBrand || "seu pedido",
          depositoName: user.bairro || "Depósito mais próximo",
        }),
        body:
          `✅ Pagamento: *${labels[method]}*\n\n` +
          buildOrderConfirmButtons({
            productSummary: user.beverageBrand || "seu pedido",
            depositoName: user.bairro || "Depósito mais próximo",
          }).body,
        _nextState: "awaiting_checkout",
        _entities: { paymentMethod: method } as any,
      };
    }

    // ── Beverage Packaging ────────────────────────────────────────────────
    case "pack_lata":
    case "pack_long_neck":
    case "pack_garrafa": {
      const packMap: Record<string, UserRecord["beveragePackType"]> = {
        pack_lata: "lata",
        pack_long_neck: "long_neck",
        pack_garrafa: "garrafa",
      };
      const packType = packMap[action];
      const labels: Record<string, string> = { 
        lata: "Lata 350ml 🍺", 
        long_neck: "Long Neck 355ml 🍾", 
        garrafa: "Garrafa 600ml 🏺",
        pack: "Pack 📦",
        litrao: "Litrão 🍼"
      };
      
      const paymentButtons = buildPaymentMethodButtons();
      return {
        ...paymentButtons,
        body: `✅ Escolhido: *${labels[packType!] || "Embalagem"}*\n\nAgora me diz: qual vai ser a forma de pagamento? 💳`,
        _nextState: "payment_method",
        _entities: { beveragePackType: packType } as any,
      };
    }

    // ── Ações do depósito ─────────────────────────────────────────────────
    case "order_accept":
      return {
        body:
          "✅ Pedido aceito! O cliente será notificado.\nClique em *preparar* quando estiver pronto para início.",
        _nextState: user.botState,
      };
    case "order_decline":
      return {
        body:
          "❌ Pedido recusado. Vou buscar outro depósito disponível.",
        _nextState: user.botState,
      };

    // ── Menu ─────────────────────────────────────────────────────────────
    case "menu_order":
      return {
        body: "Ótimo! Me diz o que você quer pedir. 🛒\nEx: _'1 Skol gelada 600ml'_, _'1 Água Crystal 5L'_...",
        _nextState: "awaiting_product",
      };
    case "menu_track":
      return {
        body:
          "Deixa eu verificar seu pedido ativo... 🔍\n\n" +
          (user.activeOrderId
            ? `Pedido ID: \`${user.activeOrderId.slice(-8)}\` em andamento.`
            : "Você não tem nenhum pedido ativo no momento."),
        _nextState: user.botState,
      };
    case "menu_help":
      return {
        body:
          "Aqui é o Dudu meu chefe, Como posso te ajudar? 🤙\n\n" +
          "- *pedir* → fazer um pedido\n" +
          "- *meu pedido* → ver status\n" +
          "- *cancelar* → cancelar pedido",
        _nextState: user.botState,
      };

    // ── Ações de rating ───────────────────────────────────────────────────
    case "rating_good":
      return {
        body: "Muito obrigado pela avaliação! 🌟 Volte sempre! 🤙",
        _nextState: "idle",
      };
    case "rating_mid":
      return {
        body: "Obrigado pelo feedback! Vamos melhorar. 💪",
        _nextState: "idle",
      };
    case "rating_bad":
      return {
        body:
          "Que pena que não foi bom! 😔 Pode me contar o que aconteceu?\nVou registrar e nossa equipe vai analisar.",
        _nextState: "idle",
      };

    case "cancel_order":
      return {
        body: "Pedido cancelado. 🙏 Pode fazer outro pedido quando quiser! 😊",
        _nextState: "idle",
      };

    case "try_alternative":
      return {
        body:
          "Claro! Me diga o que você quer como alternativa:\n\nEx: _'Água Crystal'_, _'Skol latinha'_...",
        _nextState: "awaiting_product",
      };

    // Ação desconhecida → deixa o RAG resolver
    default:
      return null;
  }
}

/**
 * Processa mensagem de localização GPS.
 * Extrai endereço/bairro e pergunta se está correto.
 */
async function handleLocationMessage(params: {
  location: NonNullable<WhatsAppInboundMessage["location"]>;
  user: UserRecord;
  tenantId: string;
  waId: string;
}): Promise<BotResponseWithState> {
  const { location } = params;

  // 1. Tenta resolver via GPS Resolver (OSM)
  if (location.latitude && location.longitude) {
    const gpsResult = await resolveGPS(location.latitude, location.longitude);
    if (gpsResult) {
      const response = buildBairroConfirmButtons(gpsResult.bairroDisplay);
      return {
        ...response,
        _nextState: "bairro_confirmation",
        // CRÍTICO: retornar bairroNorm para que o bloco GPS em processInboundMessage
        // possa salvá-lo no Firestore antes de aguardar a confirmação do botão.
        _entities: {
          bairroNorm: gpsResult.bairroNorm,
          bairro: gpsResult.bairroDisplay,
        },
      };
    }
  }

  // 2. Fallback caso resolveGPS retorne null ou coordenadas ausentes
  const bairroDetected = location.name ?? location.address ?? "seu bairro";
  const response = buildBairroConfirmButtons(bairroDetected);

  return {
    ...response,
    _nextState: "bairro_confirmation",
    // Não temos bairroNorm confiável no fallback — não salvar para não poluir
  };
}

/**
 * Determina os botões contextuais a incluir na resposta do RAG
 * com base no estado atual do usuário.
 */
function resolveResponseForState(params: {
  currentState: UserBotState;
  ragAnswer: string;
  inputText: string;
  user: UserRecord;
}): BotResponseWithState {
  const { currentState, ragAnswer, inputText, user } = params;
  const lowerText = inputText.toLowerCase();

  const hasOrderIntent =
    lowerText.includes("quero") ||
    lowerText.includes("pedir") ||
    lowerText.includes("me manda") ||
    lowerText.includes("skol") ||
    lowerText.includes("heineken") ||
    lowerText.includes("brahma") ||
    lowerText.includes("agua") ||
    lowerText.includes("água") ||
    lowerText.includes("cerveja") ||
    lowerText.includes("bebida");

  const hasLocationIntent =
    lowerText.includes("bairro") ||
    lowerText.includes("onde") ||
    lowerText.includes("localização") ||
    lowerText.includes("endereço");

  switch (currentState) {
    case "idle":
      if (hasOrderIntent) {
        return {
          body: ragAnswer,
          _nextState: user.bairroNorm ? "awaiting_product" : "awaiting_neighborhood",
          // ADDED: Sugere localização GPS imediatamente se o bairro for desconhecido
          ...(user.bairroNorm ? {} : buildLocationRequestMessage("bairro")),
        };
      }
      // Menu inicial para novos usuários
      if (lowerText.includes("oi") || lowerText.includes("olá") || lowerText.includes("ola")) {
        return {
          ...buildMainMenuButtons(ragAnswer),
          _nextState: "idle",
        };
      }
      return { body: ragAnswer, _nextState: "idle" };

    case "awaiting_neighborhood":
      if (hasLocationIntent) {
        return {
          ...buildLocationRequestMessage("bairro"),
          _nextState: "awaiting_neighborhood",
        };
      }
      return { body: ragAnswer, _nextState: "awaiting_product" };

    case "awaiting_product": {
      // ── 1. Resolve embalagem/vasilhame antes de avançar ──────────────────
      const beverageResult = resolveBeverage(inputText, user.hasVasilhame);

      if (beverageResult.clarificationNeeded) {
        const isPackaging = beverageResult.clarificationNeeded === "embalagem";
        const isVasilhame = beverageResult.clarificationNeeded === "vasilhame";

        return {
          body: buildClarificationQuestion(beverageResult.clarificationNeeded, beverageResult.brand),
          _nextState: isVasilhame ? "awaiting_vasilhame" : "awaiting_beverage_clarification",
          // MODIFIED: Usa botões para embalagem e vasilhame
          ...(isVasilhame ? buildVasilhameButtons() : {}),
          ...(isPackaging ? buildBeveragePackagingButtons(beverageResult.brand) : {}),
          _entities: {
            beverageBrand: beverageResult.brand,
            beverageVolumeMl: beverageResult.volumeMl,
            beveragePackType: beverageResult.packType,
            slots: { ...user.slots, quantity: beverageResult.quantity || (user.slots as any)?.quantity }
          } as any
        };
      }

      // ── 2. Gate de maioridade para bebidas alcoólicas ────────────────────
      if (beverageResult.isAlcoholic && !user.ageConfirmed) {
        return {
          ...buildAgeGateButtons(extractProductName(inputText)),
          _nextState: "awaiting_product",
        };
      }

      return {
        body: ragAnswer,
        _nextState: "awaiting_checkout",
      };
    }

    case "awaiting_beverage_clarification": {
      // Cliente respondeu qual embalagem quer — re-resolve com o novo texto
      const clarified = resolveBeverage(inputText, user.hasVasilhame);
      if (clarified.clarificationNeeded) {
        const isPackaging = clarified.clarificationNeeded === "embalagem";
        const isVasilhame = clarified.clarificationNeeded === "vasilhame";

        return {
          body: buildClarificationQuestion(clarified.clarificationNeeded, clarified.brand),
          _nextState: isVasilhame ? "awaiting_vasilhame" : "awaiting_beverage_clarification",
          // ADDED: Botões para re-clarificar se necessário
          ...(isVasilhame ? buildVasilhameButtons() : {}),
          ...(isPackaging ? buildBeveragePackagingButtons(clarified.brand) : {}),
          _entities: {
            beverageBrand: clarified.brand,
            beverageVolumeMl: clarified.volumeMl,
            beveragePackType: clarified.packType,
            slots: { ...user.slots, quantity: clarified.quantity || (user.slots as any)?.quantity }
          } as any
        };
      }
      if (clarified.isAlcoholic && !user.ageConfirmed) {
        return {
          ...buildAgeGateButtons(extractProductName(inputText)),
          _nextState: "awaiting_beverage_clarification",
        };
      }
      return { body: ragAnswer, _nextState: "awaiting_checkout" };
    }

    case "awaiting_vasilhame": {
      // Cliente respondeu sobre vasilhame
      const hasVasilhame =
        /\bsim\b|\btenho\b|\btem\b|\btempero\b|\bclaro\b|\bpode\b|\bbora\b/i.test(inputText);
      const refusedVasilhame =
        /\bnão\b|\bnao\b|\bsem\b|\bnunca\b/i.test(inputText);

      if (refusedVasilhame) {
        return {
          body: "Sem vasilhame, mermão! Posso buscar em garrafa 600ml ou lata — prefere qual? 🍺",
          _nextState: "awaiting_beverage_clarification",
          _entities: { hasVasilhame: false } as any,
        };
      }
      if (hasVasilhame) {
        if (!user.ageConfirmed) {
          return {
            ...buildAgeGateButtons(extractProductName(inputText)),
            _nextState: "awaiting_vasilhame",
            _entities: { hasVasilhame: true } as any,
          };
        }
        return {
          body: ragAnswer,
          _nextState: "awaiting_checkout",
          _entities: { hasVasilhame: true } as any,
        };
      }
      if (inputText.trim().length > 0) {
        return {
          body: "Não peguei, chefe. Você já tem vasilhame? Responde só *sim* ou *não*.",
          _nextState: "awaiting_vasilhame",
        };
      }
      return {
        body: "Você tem vasilhame (botijão ou garrão)? É só confirmar pra eu buscar o parceiro certo. 🫙",
        _nextState: "awaiting_vasilhame",
      };
    }

    case "awaiting_checkout":
      // Se pagamento ainda não foi escolhido, perguntar primeiro
      if (!user.paymentMethod) {
        return {
          ...buildPaymentMethodButtons(extractProductName(inputText)),
          _nextState: "payment_method",
        };
      }
      // Pagamento já escolhido — mostrar resumo completo para confirmação
      return {
        ...buildOrderConfirmButtons({
          productSummary: extractProductName(inputText),
          depositoName: user.bairro || "Depósito mais próximo",
        }),
        _nextState: "awaiting_checkout",
      };

    case "payment_method":
      // MODIFIED: Use interactive buttons for payment selection
      {
        const pm = inputText.toLowerCase();
        let detectedMethod: UserRecord["paymentMethod"] = null;
        if (pm.includes("pix") || pm.includes("pay_pix")) detectedMethod = "pix";
        else if (pm.includes("cartao") || pm.includes("cartão") || pm.includes("card") || pm.includes("pay_cartao")) detectedMethod = "cartao";
        else if (pm.includes("dinheiro") || pm.includes("espécie") || pm.includes("especie") || pm.includes("cash") || pm.includes("pay_dinheiro")) detectedMethod = "dinheiro";

        if (detectedMethod) {
          return {
            ...buildOrderConfirmButtons({
              productSummary: extractProductName(inputText),
              depositoName: user.bairro || "Depósito mais próximo",
            }),
            _nextState: "awaiting_checkout",
            _entities: { paymentMethod: detectedMethod } as any,
          };
        }
        
        // Não reconheceu — pedir de novo com botões
        return {
          ...buildPaymentMethodButtons(extractProductName(inputText)),
          _nextState: "payment_method",
        };
      }

    case "deposito_signup_start":
      return {
        body: "Legal! Para eu te cadastrar como depósito parceiro do Chama Dudu, preciso de algumas informações.\n\nQual o **Nome do Responsável Completo** (seu nome)?",
        _nextState: "deposito_signup_responsavel",
      };

    case "deposito_signup_responsavel":
      return {
        body: `Anotado, ${inputText}! Qual o **Nome do depósito**?`,
        _nextState: "deposito_signup_nome",
        _entities: { responsavel: inputText } as any
      };

    case "deposito_signup_nome":
      return {
        body: `Beleza. Me diz o **WhatsApp** com DDD para o sistema te notificar dos pedidos (Ex: 81999999999).`,
        _nextState: "deposito_signup_whatsapp",
        _entities: { depositoNome: inputText } as any
      };

    case "deposito_signup_whatsapp":
      return {
        body: `E aí, o depósito é de qual **Cidade**?`,
        _nextState: "deposito_signup_cidade",
        _entities: { depositoWhatsapp: inputText } as any
      };

    case "deposito_signup_cidade":
      return {
        body: `Perfeito! Em qual **Bairro** de ${inputText}?`,
        _nextState: "deposito_signup_bairro",
        _entities: { depositoCidade: inputText } as any
      };

    case "deposito_signup_bairro":
      return {
        body: `Valeu! Pra fechar, você tem **CNPJ/CPF**? (Mande os números ou responda "Não")`,
        _nextState: "deposito_signup_cnpj",
        _entities: { depositoBairro: inputText } as any
      };

    case "deposito_signup_cnpj":
      return {
        body: `Quase lá! Você usa **frota/entregador próprio**?`,
        _nextState: "deposito_signup_frota",
        _entities: { depositoCnpj: inputText } as any,
        buttons: [
          { id: "signup_frota_yes", title: "✅ Sim, tenho" },
          { id: "signup_frota_no",  title: "❌ Não, preciso" },
        ]
      };

    case "deposito_signup_frota": {
      const isYes = inputText.toLowerCase().includes("sim") || inputText.toLowerCase().includes("yes") || inputText.includes("frota_yes");
      const frotaValue = isYes ? "Sim" : "Não";
      const s = user.slots || {};
      const summary = 
        `📝 *Resumo do Cadastro:*\n\n` +
        `• *Responsável:* ${s.responsavel || "---"}\n` +
        `• *Depósito:* ${s.depositoNome || "---"}\n` +
        `• *WhatsApp:* ${s.depositoWhatsapp || "---"}\n` +
        `• *Cidade:* ${s.depositoCidade || "---"}\n` +
        `• *Bairro:* ${s.depositoBairro || "---"}\n` +
        `• *CNPJ:* ${s.depositoCnpj || "---"}\n` +
        `• *Frota Própria:* ${frotaValue}`;

      return {
        body: summary + `\n\nPodemos confirmar seu pré-cadastro? 🚀`,
        _nextState: "deposito_signup_confirm",
        _entities: { depositoFrota: frotaValue } as any,
        buttons: [
          { id: "signup_confirm_yes", title: "✅ Confirmar Cadastro" },
          { id: "signup_confirm_no",  title: "✏️ Corrigir" },
        ]
      };
    }

    case "deposito_signup_confirm":
      if (inputText.toLowerCase().includes("confirmar") || inputText.includes("confirm_yes")) {
        return {
          body: `Tudo certo, parceiro! ✅ Seu pré-cadastro foi finalizado e enviado com sucesso ao time do Chama Dudu. \n\nEm breve entraremos em contato para validar e liberar seu acesso ao painel de pedidos. Valeu a parceria! 🚀`,
          _nextState: "idle",
        };
      }
      return {
        body: `Sem problema! Qual o **Nome do Responsável Completo**? (Vamos recomeçar)`,
        _nextState: "deposito_signup_responsavel",
      };

    case "awaiting_delivery_address":
      if (hasLocationIntent) {
        return {
          ...buildDeliveryAddressRequest(),
          _nextState: "awaiting_delivery_address",
        };
      }
      return {
        body: ragAnswer,
        _nextState: "awaiting_deposit_response",
      };

    case "awaiting_deposit_response":
      return {
        body: ragAnswer,
        _nextState: "awaiting_deposit_response",
      };

    case "bairro_confirmation":
      // MODIFIED: Use interactive buttons for address confirmation
      return { 
        ...buildBairroConfirmButtons(user.bairroNorm || "seu bairro", ragAnswer), 
        _nextState: "awaiting_product" 
      };

    case "order_placed":
      return {
        body: ragAnswer,
        _nextState: "idle",
      };

    default:
      return { body: ragAnswer, _nextState: currentState };
  }
}

/**
 * Extrai um nome de produto aproximado do texto do usuário
 */
function extractProductName(text: string): string {
  const beveragePatterns = [
    /skol/i, /heineken/i, /brahma/i, /bud/i, /antarctica/i,
    /vinho/i, /whisky/i, /cachaça/i, /cerveja/i,
  ];
  for (const pattern of beveragePatterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return "bebida alcoólica";
}

/**
 * Persiste o estado do usuário, entidades extraídas e histórico de conversa.
 * É CRÍTICO passar as entidades aqui para que bairroNorm/beverage não se percam
 * entre os turnos (o LLM não tem memória própria — ela fica no Firestore).
 */
async function persistStateUpdate(params: {
  tenantId: string;
  waId: string;
  user: UserRecord;
  responseText: string;
  inputText: string;
  nextState?: UserBotState;
  lastIntent?: UserRecord["lastIntent"];
  lastIntentConfidence?: UserRecord["lastIntentConfidence"];
  /** Entidades extraídas do agentPayload neste turno (bairroNorm, beverage, etc.) */
  entities?: ExtractedEntities;
}): Promise<void> {
  const {
    tenantId,
    waId,
    user,
    responseText,
    inputText,
    nextState,
    entities,
    lastIntent,
    lastIntentConfidence,
  } = params;

  const newHistory: UserRecord["conversationHistory"] = [
    ...(user.conversationHistory ?? []),
    {
      role: "user" as const,
      content: inputText,
      timestampMs: Date.now(),
    },
    {
      role: "model" as const,
      content: responseText,
      timestampMs: Date.now(),
    },
  ].slice(-20); // Limita a 20 mensagens (10 trocas)

  // Mescla: se o agentPayload trouxe entidade nova, usa ela; caso contrário,
  // mantém UNDEFINED (não nulo) para o transitionUserState ignorar o update 
  // e preservar o que já existe no Firebase.

  // Custom properties from deposito signup
  const slotsUpdates = user.slots || {};
  if (entities && (entities as any).responsavel) slotsUpdates.responsavel = (entities as any).responsavel;
  if (entities && (entities as any).depositoNome) slotsUpdates.depositoNome = (entities as any).depositoNome;
  if (entities && (entities as any).depositoWhatsapp) slotsUpdates.depositoWhatsapp = (entities as any).depositoWhatsapp;
  if (entities && (entities as any).depositoCidade) slotsUpdates.depositoCidade = (entities as any).depositoCidade;
  if (entities && (entities as any).depositoBairro) slotsUpdates.depositoBairro = (entities as any).depositoBairro;
  if (entities && (entities as any).depositoCnpj) slotsUpdates.depositoCnpj = (entities as any).depositoCnpj;
  if (entities && (entities as any).depositoFrota) {
    slotsUpdates.depositoFrota = (entities as any).depositoFrota;

    // Attempt webhook or DB update at the end of the FSM here if needed, 
    // or just rely on Ops dashboard reading these slots.
  }

  const bairroNorm = "bairroNorm" in (entities || {}) ? entities?.bairroNorm : undefined;
  const bairro = "bairro" in (entities || {}) ? entities?.bairro : undefined;
  const beverageBrand = "beverageBrand" in (entities || {}) ? entities?.beverageBrand : undefined;
  const beverageVolumeMl = "beverageVolumeMl" in (entities || {}) ? entities?.beverageVolumeMl : undefined;
  const beveragePackType = "beveragePackType" in (entities || {}) ? entities?.beveragePackType : undefined;
  const hasVasilhame = "hasVasilhame" in (entities || {}) ? entities?.hasVasilhame : undefined;
  const ageConfirmed = "ageConfirmed" in (entities || {}) ? entities?.ageConfirmed : undefined;
  const paymentMethod = "paymentMethod" in (entities || {}) ? entities?.paymentMethod : undefined;

  try {
    await opsRepositories.transitionUserState?.({
      tenantId,
      waId: user.waId ?? null,
      bsuId: user.bsuId,
      waUsername: user.waUsername,
      name: user.name,
      type: user.type,
      botState: nextState ?? user.botState,
      botStateExpiresAtMs: Date.now() + 15 * 60 * 1000, // 15 min
      conversationHistory: newHistory,
      lastActivityAtMs: Date.now(),
      lastIntent,
      lastIntentConfidence,
      bairroNorm,
      bairro,
      beverageBrand,
      beverageVolumeMl,
      beveragePackType,
      hasVasilhame,
      ageConfirmed,
      paymentMethod,
      slots: Object.fromEntries(
        Object.entries({
          ...slotsUpdates,
          product: beverageBrand ?? user.slots?.product,
        }).filter(([_, v]) => v !== undefined)
      ) as any,
    });
  } catch (error) {
    logger.error("[StateEngine] Falha ao persistir estado", {
      tenantId,
      waId,
      error: String(error),
    });
  }
}

/**
 * Fallback determinista (Pure API) quando o RAG falha ou não encontra resposta.
 * Busca depósitos no bairro confirmado do usuário.
 */
async function executeManualSearchFallback(params: {
  tenantId: string;
  waId: string;
  user: UserRecord;
}): Promise<BotResponseWithState> {
  const { tenantId, user } = params;
  const bairro = user.bairroNorm || user.bairro || (user.slots as any)?.neighborhood;

  if (!bairro) {
    logger.warn("[SEARCH_FALLBACK_SKIP] No neighborhood found for user. Asking for it.", { waId: params.waId });
    const locReq = buildLocationRequestMessage("bairro");
    return {
      ...locReq,
      body: "Para eu encontrar os depósitos mais próximos, preciso saber seu bairro ou localização. 📍\n" + locReq.body,
      _nextState: "awaiting_neighborhood",
    };
  }

  logger.info("[SEARCH_FALLBACK_TRIGGERED] Manual search for:", { tenantId, bairro });

  try {
    const depositos = await listarDepositosAbertosPorBairro(tenantId, bairro);

    if (depositos.length > 0) {
      logger.info("[SEARCH_FALLBACK_SUCCESS] Deposits found.", { count: depositos.length });
      return {
        body: `Vou fazer uma busca manual aqui mermão... Achei depósitos atendendo em *${bairro}* agora! 🚀\n\nO que você gostaria de pedir?\nEx: _'1 Skol gelada 600ml'_`,
        _nextState: "awaiting_product",
      };
    } else {
      logger.warn("[SEARCH_FALLBACK_EMPTY] No deposits found in manual search.");
      const menu = buildMainMenuButtons();
      return {
        ...menu,
        body: `Vou fazer uma busca manual... Realmente não encontrei nenhum depósito aberto em *${bairro}* agora. 🙏\n\n` + menu.body,
        _nextState: "idle",
      };
    }
  } catch (err) {
    logger.error("[SEARCH_FALLBACK_ERROR]", { error: String(err) });
    return {
      body: "Eita, deu um probleminha na busca. Tenta de novo em 1 minutinho! 🙏",
      _nextState: user.botState,
    };
  }
}
