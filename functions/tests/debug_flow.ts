import { botkitManager } from "../src/domain/whatsapp/botkitController";
import { parseWithRasa } from "../src/infra/nlu/rasaClient";
import { vi } from "vitest";

// Minimal mock setup
vi.mock("../src/infra/nlu/rasaClient", () => ({
  parseWithRasa: vi.fn(),
}));

async function runDebug() {
  const mockRepo = {
    getUserByTenantWaId: async () => ({ waId: "123", botState: "idle", type: "cliente" }),
    transitionUserState: async (p: any) => {
        console.log("DEBUG: Repo.transitionUserState called with state:", p.botState);
        return p;
    },
    acquireProcessingLock: async () => "acquired",
    releaseProcessingLock: async () => undefined,
  };
  const mockMessenger = {
    sendText: async (p: any) => console.log("DEBUG: Messenger.sendText called with body:", p.body),
    sendClienteButtons: async (p: any) => console.log("DEBUG: Messenger.sendClienteButtons called with body:", p.body),
  };

  (parseWithRasa as any).mockResolvedValue({
    classification: { intent: "saudacao", confidence: 0.9, reasons: ["mock"] },
    entities: { bairro: null, bairroNorm: null, beverage: null },
  });

  console.log("DEBUG: Starting handleInbound...");
  await botkitManager.handleInbound({
    tenantId: "t1",
    waId: "123",
    message: { waId: "123", text: "Oi", phoneNumberId: "p1", messageId: "m1", type: "text" } as any,
    repo: mockRepo as any,
    messenger: mockMessenger as any,
  });
  console.log("DEBUG: handleInbound finished.");
}

runDebug();
