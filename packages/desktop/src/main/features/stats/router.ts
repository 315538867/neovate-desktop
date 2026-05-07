import { contract } from "../../../shared/contract";
import { defineRouterNoContext } from "../../core/router-factory";
import { getStatsService } from "./stats-service";

const { os } = defineRouterNoContext({
  contract: contract.stats,
  debugNs: "neovate:stats",
});

export const statsRouter = {
  getSummary: os.getSummary.handler(({ input }) => {
    return getStatsService().getSummaryStats(input.range);
  }),

  getCostTrend: os.getCostTrend.handler(({ input }) => {
    return getStatsService().getCostTrend(input.range);
  }),

  getModelBreakdown: os.getModelBreakdown.handler(({ input }) => {
    return getStatsService().getModelBreakdown(input.range);
  }),

  getActivityHeatmap: os.getActivityHeatmap.handler(({ input }) => {
    return getStatsService().getActivityHeatmap(input.days);
  }),
};
