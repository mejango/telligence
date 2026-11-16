import { StageData } from "../types";
import { getCurrentStageDuration, getStageCutFrequencySeconds } from "./calculatePickupIssuance";

export function calculateFinalStageStarts(stages: StageData[]): StageData[] {
  return stages.map((stage, index) => {
    if (index === 0) return stage;

    if (stage.stageStartCuts) {
      const previousStage = stages[index - 1];
      if (getStageCutFrequencySeconds(previousStage) > 0) {
        return {
          ...stage,
          stageStart: getCurrentStageDuration(stage, previousStage),
          // Remove stageStartCuts from final data
          stageStartCuts: undefined,
        };
      }
    }

    return stage;
  });
}
