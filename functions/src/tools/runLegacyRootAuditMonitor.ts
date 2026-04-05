import { runLegacyRootAuditMonitor } from "../jobs/legacyRootAuditMonitor";

async function main(): Promise<void> {
  const report = await runLegacyRootAuditMonitor();
  console.log("LEGACY_ROOT_AUDIT_MONITOR_REPORT");
  console.log(
    JSON.stringify(
      {
        projectId: report.projectId,
        generatedAt: report.generatedAt,
        status: report.status,
        alertCollections: report.alertCollections,
        collections: report.collections.map((item) => ({
          collection: item.collection,
          total: item.total,
          status: item.status,
          deltaStatus: item.deltaStatus,
          deltaTotal: item.deltaTotal,
          newSampleIds: item.newSampleIds,
          recentDocCount: item.recentDocCount,
          sampleIds: item.sampleIds,
        })),
      },
      null,
      2,
    ),
  );

  if (report.status === "ALERT") {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error("LEGACY_ROOT_AUDIT_MONITOR_FAILED", error);
  process.exit(1);
});

