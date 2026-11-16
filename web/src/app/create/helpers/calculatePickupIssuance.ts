import { StageData } from "../types";

export function calculatePickupIssuance(
  previousStage: StageData,
  currentStageDuration: string | number,
): string | null {
  if (!previousStage || !currentStageDuration) return null;

  const baseIssuance = Number(previousStage.initialIssuance);
  const cutPercentage = Number(previousStage.priceCeilingIncreasePercentage);
  const cutFrequency = getStageCutFrequencySeconds(previousStage);
  const stageDuration = Math.round(Number(currentStageDuration) * 86_400);

  if (cutPercentage === 0 || cutFrequency === 0) {
    return previousStage.initialIssuance;
  }

  const numberOfCuts = Math.floor(stageDuration / cutFrequency);

  const finalIssuance = baseIssuance * Math.pow((100 - cutPercentage) / 100, numberOfCuts);

  return finalIssuance.toFixed(3);
}

export function getCurrentStageDuration(currentStage: StageData, previousStage: StageData): string {
  return String(getCurrentStageDurationSeconds(currentStage, previousStage) / 86_400);
}

/** The exact duration REVDeployer passes to JBRulesets, in whole seconds. */
export function getStageCutFrequencySeconds(stage: StageData): number {
  // toFixed first: 1.005 days is 86832 seconds, which a float holds as 86831.99…
  return Math.floor(Number((Number(stage.priceCeilingIncreaseFrequency) * 86_400).toFixed(3))) || 0;
}

/** A follower starts after a complete cycle of its actual predecessor. */
function getCurrentStageDurationSeconds(currentStage: StageData, previousStage: StageData): number {
  const frequency = getStageCutFrequencySeconds(previousStage);
  const requested =
    currentStage.stageStartCuts && frequency > 0
      ? Number(currentStage.stageStartCuts) * frequency
      : Math.round(Number(currentStage.stageStart) * 86_400);
  // Explicit dates are lower bounds: core snaps them to a predecessor cycle.
  // Encoding that same boundary keeps following stages based on this stage.
  return frequency > 0
    ? Math.ceil(Math.max(requested, frequency) / frequency) * frequency
    : Math.floor(requested);
}

/** The immutable schedule shared by the review chart and deploy compiler. */
export function getStageStarts(stages: StageData[], preparationTimestamp: number): number[] {
  if (!stages.length) return [];
  const explicitStart = Number(stages[0].futureStartTimestamp);
  const starts = [explicitStart > 0 ? explicitStart : preparationTimestamp + 600];
  for (let index = 1; index < stages.length; index++) {
    starts.push(
      starts[index - 1] + getCurrentStageDurationSeconds(stages[index], stages[index - 1]),
    );
  }
  return starts;
}

export function getResolvedIssuance(
  stage: StageData,
  stageIndex: number,
  allStages: StageData[],
): string {
  if (!stage.pickUpFromPrevious || stageIndex === 0) {
    return stage.initialIssuance;
  }

  const previousStage = allStages[stageIndex - 1];

  const previousStageIssuance = previousStage.pickUpFromPrevious
    ? getResolvedIssuance(previousStage, stageIndex - 1, allStages)
    : previousStage.initialIssuance;

  const resolvedPreviousStage = {
    ...previousStage,
    initialIssuance: previousStageIssuance,
  };

  const currentStageDuration = getCurrentStageDuration(stage, previousStage);
  return (
    calculatePickupIssuance(resolvedPreviousStage, currentStageDuration) || stage.initialIssuance
  );
}
