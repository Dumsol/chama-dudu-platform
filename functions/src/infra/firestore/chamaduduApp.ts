// functions/src/core/chamaduduApp.ts
import { productDoc } from "./duduPaths";

// Deprecated adapter: mantem compatibilidade sem usar base legacy.
export function getChamaduduAppDocRef(tenantCnpj?: string) {
  const tenantId = String(tenantCnpj ?? "app");
  return productDoc(tenantId);
}
