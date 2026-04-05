import * as logger from "firebase-functions/logger";
import { onCall, CallableRequest } from "firebase-functions/v2/https";
import { opsSecrets } from "../../config/opsRuntime";

/**
 * Retorna dados em série temporal formatados para alimentar
 * o dashboard clone do Elastic Stack no frontend Nuxt.
 */
export const dudu_elasticMetrics = onCall(
  {
    secrets: [opsSecrets.internalReplaySecret],
    region: "southamerica-east1",
    cors: true,
  },
  async (request: CallableRequest) => {
    logger.info("Fetching Elastic Stack clone metrics...");

    // Gerador de mock timeseries para preencher os gráficos exigidos
    const generateTimeseries = (count: number, min: number, max: number) => {
      const data = [];
      const now = Date.now();
      for (let i = count; i > 0; i--) {
        data.push({
          x: new Date(now - i * 60000).toISOString(),
          y: Math.floor(Math.random() * (max - min + 1)) + min,
        });
      }
      return data;
    };

    const hostColors = ["#1d7e5d", "#c91c12", "#00ffff", "#ff00ff", "#ff7f00"];

    return {
      overview: {
        healthyDeployments: 3,
        unhealthyDeployments: 1,
        startedShards: 2490,
        initializingShards: 0,
        unassignedShardsRed1: 63,
        unassignedShardsRed2: 63,
      },
      series: {
        activeShards: generateTimeseries(60, 10000, 60000), // Spikes
        queryLatency: generateTimeseries(60, 50, 2000),
        averageQueries: generateTimeseries(60, 10, 30),
        maxQueries: generateTimeseries(60, 20, 50),
        indexingLatency: generateTimeseries(60, 0, 10),
        indexRefreshTime: generateTimeseries(60, 50, 150),
        indexingTotal: generateTimeseries(60, 0, 1),
        jvmHeapUsed: hostColors.map((color, i) => ({
          label: `Node ${i + 1}`,
          data: generateTimeseries(60, 20, 80),
          borderColor: color,
        })),
        jvmGcYoungCount: generateTimeseries(10, 0, 100), // Bar chart
        jvmHeapAvg: generateTimeseries(60, 40, 50),
        jvmGcAverageTime: generateTimeseries(60, 5, 20),
        searchThreadPoolMax: generateTimeseries(60, 0, 50),
        searchThreadPoolRejections: generateTimeseries(60, 0, 5),
        bulkThreadPoolMax: generateTimeseries(60, 0, 10),
        bulkThreadPoolRejections: generateTimeseries(60, 0, 2),
        clusterPendingTasksCount: generateTimeseries(60, 0, 5),
        clusterPendingTasksTime: generateTimeseries(60, 0, 20),
      },
      kpi: {
        unsuccessfulGets: 0,
        diskSpaceUsed: "93.55%",
      },
      timestamp: new Date().toISOString(),
    };
  }
);
