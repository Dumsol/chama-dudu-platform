import { describe, expect, it } from "vitest";
import {
  assertTenantId,
  messagesCol,
  orderIssuesCol,
  pingInterestsCol,
  preCadastrosCol,
  processedMessagesCol,
  rateLimitsCol,
  usersCol,
} from "../src/infra/firestore/duduPaths";

describe("tenant-scoped firestore paths", () => {
  it("builds tenant-scoped operational collections", () => {
    expect(usersCol("tenant-a").path).toBe("tenants/tenant-a/products/dudu/users");
    expect(messagesCol("tenant-a").path).toBe("tenants/tenant-a/products/dudu/mensagens");
    expect(processedMessagesCol("tenant-a").path).toBe(
      "tenants/tenant-a/products/dudu/processedMessages",
    );
    expect(preCadastrosCol("tenant-a").path).toBe("tenants/tenant-a/products/dudu/preCadastros");
    expect(rateLimitsCol("tenant-a").path).toBe("tenants/tenant-a/products/dudu/rate_limits");
    expect(orderIssuesCol("tenant-a", "order-1").path).toBe(
      "tenants/tenant-a/products/dudu/orders/order-1/issues",
    );
    expect(pingInterestsCol("tenant-a").path).toBe("tenants/tenant-a/products/dudu/ping_interests");
  });

  it("fails fast when tenantId is missing", () => {
    expect(() => assertTenantId("")).toThrow("tenantId is required");
    expect(() => usersCol("")).toThrow("tenantId is required");
  });
});
