import { describe, expect, it } from "vitest";
import {
  LEGACY_ROOT_COLLECTIONS,
  buildLegacyAuditReport,
  decideLegacyMigration,
  extractTenantIdFromData,
  suggestLegacyAction,
} from "../src/tools/legacyRootCollections";

describe("legacy root audit helpers", () => {
  it("tracks all required legacy root collections", () => {
    expect(LEGACY_ROOT_COLLECTIONS).toEqual(
      expect.arrayContaining([
        "users",
        "depositos",
        "mensagens",
        "processedMessages",
        "precadastros",
        "rateLimits",
        "printQueue",
      ]),
    );
  });

  it("extracts tenantId safely", () => {
    expect(extractTenantIdFromData({ tenantId: "tenant-a" })).toBe("tenant-a");
    expect(extractTenantIdFromData({ tenantId: "  " })).toBeNull();
    expect(extractTenantIdFromData({})).toBeNull();
  });

  it("suggests actions based on sample composition", () => {
    expect(suggestLegacyAction({ total: 0, sampleWithTenantId: 0, sampleWithoutTenantId: 0 })).toBe("ja_vazio");
    expect(suggestLegacyAction({ total: 9, sampleWithTenantId: 6, sampleWithoutTenantId: 0 })).toBe("migrar");
    expect(suggestLegacyAction({ total: 9, sampleWithTenantId: 2, sampleWithoutTenantId: 4 })).toBe(
      "migrar_com_orfaos",
    );
    expect(suggestLegacyAction({ total: 9, sampleWithTenantId: 0, sampleWithoutTenantId: 4 })).toBe(
      "investigar_orfaos",
    );
  });

  it("builds report payload with deterministic fields", () => {
    const report = buildLegacyAuditReport({
      collection: "users",
      total: 4,
      sampleIds: ["a", "b"],
      sampleWithTenantId: 1,
      sampleWithoutTenantId: 1,
    });
    expect(report.collection).toBe("users");
    expect(report.total).toBe(4);
    expect(report.sampleAnalyzed).toBe(2);
    expect(report.suggestedAction).toBe("migrar_com_orfaos");
  });
});

describe("legacy migration decisions", () => {
  it("does not migrate when tenantId is missing", () => {
    expect(
      decideLegacyMigration({
        data: { foo: "bar" },
        targetExists: false,
        dryRun: true,
        forceOverwrite: false,
      }),
    ).toEqual({ action: "skip_missing_tenant" });
  });

  it("respects dry-run mode", () => {
    expect(
      decideLegacyMigration({
        data: { tenantId: "tenant-a" },
        targetExists: false,
        dryRun: true,
        forceOverwrite: false,
      }),
    ).toEqual({ action: "dry_run_migrate", tenantId: "tenant-a" });
  });

  it("is idempotent when target already exists without force overwrite", () => {
    expect(
      decideLegacyMigration({
        data: { tenantId: "tenant-a" },
        targetExists: true,
        dryRun: false,
        forceOverwrite: false,
      }),
    ).toEqual({ action: "skip_existing" });
  });

  it("allows migrate when force overwrite is enabled", () => {
    expect(
      decideLegacyMigration({
        data: { tenantId: "tenant-a" },
        targetExists: true,
        dryRun: false,
        forceOverwrite: true,
      }),
    ).toEqual({ action: "migrate", tenantId: "tenant-a" });
  });

  it("simulates dry-run and idempotent behavior for saneamento", () => {
    const sourceDocs = [
      { id: "a", data: { tenantId: "tenant-a", value: 1 } },
      { id: "b", data: { tenantId: "tenant-a", value: 2 } },
      { id: "orphan", data: { value: 999 } },
    ];

    const target = new Map<string, unknown>();

    const run = (dryRun: boolean) => {
      for (const doc of sourceDocs) {
        const decision = decideLegacyMigration({
          data: doc.data,
          targetExists: target.has(doc.id),
          dryRun,
          forceOverwrite: false,
        });
        if (decision.action === "migrate") {
          target.set(doc.id, doc.data);
        }
      }
    };

    run(true);
    expect(target.size).toBe(0);

    run(false);
    expect(target.size).toBe(2);
    expect(target.has("orphan")).toBe(false);

    run(false);
    expect(target.size).toBe(2);
  });
});
