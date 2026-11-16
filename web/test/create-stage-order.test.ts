import {
  getCurrentStageDuration,
  getResolvedIssuance,
  getStageStarts,
} from "@/app/create/helpers/calculatePickupIssuance";
import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import { calculateFinalStageStarts } from "@/app/create/helpers/recalculateStageStarts";
import type { StageData } from "@/app/create/types";
import { sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { EMPTY_SUCKER_CONFIG, TEST_SALT, TEST_TIMESTAMP, validRevnetForm } from "./fixtures/revnet";

const DAY = 86_400;

function stages(overrides: Partial<StageData>[] = []): StageData[] {
  const first = validRevnetForm().stages[0];
  return overrides.map((override) => ({ ...first, ...override }));
}

function compiled(input: StageData[]) {
  const form = validRevnetForm();
  form.stages = calculateFinalStageStarts(input);
  return parseDeployData(form, {
    metadataCid: "bafy-metadata",
    chainId: sepolia.id,
    suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
    timestamp: TEST_TIMESTAMP,
    salt: TEST_SALT,
    creationFee: 0n,
  }).args[1].stageConfigurations;
}

describe("ordered revnet stage boundaries", () => {
  it("bases the third stage on the cycle-snapped second stage", () => {
    const input = stages([
      { stageStart: "0", priceCeilingIncreaseFrequency: "30" },
      { stageStart: "45", stageStartCuts: "1.5", priceCeilingIncreaseFrequency: "1" },
      { stageStart: "1", priceCeilingIncreaseFrequency: "0" },
    ]);
    const result = compiled(input);
    const start = TEST_TIMESTAMP + 600;
    expect(result.map((stage) => Number(stage.startsAtOrAfter))).toEqual([
      start,
      start + 60 * DAY,
      start + 61 * DAY,
    ]);
    expect(getStageStarts(input, TEST_TIMESTAMP)).toEqual(
      result.map((stage) => Number(stage.startsAtOrAfter)),
    );
    expect(getCurrentStageDuration(input[1], input[0])).toBe("60");
    expect(getResolvedIssuance({ ...input[1], pickUpFromPrevious: true }, 1, input)).toBe(
      "810.000",
    );
  });

  it("snaps to encoded whole-second frequencies rather than approximate days", () => {
    const input = stages([
      { stageStart: "0", priceCeilingIncreaseFrequency: "0.00003" },
      { stageStart: "0", stageStartCuts: "1.5", priceCeilingIncreaseFrequency: "0.00004" },
      { stageStart: "0", stageStartCuts: "1", priceCeilingIncreaseFrequency: "0" },
    ]);
    const result = compiled(input);
    const start = TEST_TIMESTAMP + 600;
    expect(result.map((stage) => Number(stage.issuanceCutFrequency))).toEqual([2, 3, 0]);
    expect(result.map((stage) => Number(stage.startsAtOrAfter))).toEqual([
      start,
      start + 4,
      start + 7,
    ]);
  });

  it("preserves an explicit first date and non-cycle delays after a no-cut stage", () => {
    const firstStart = TEST_TIMESTAMP + 90 * DAY;
    const input = stages([
      { stageStart: "0", futureStartTimestamp: firstStart, priceCeilingIncreaseFrequency: "0" },
      { stageStart: "1.5", priceCeilingIncreaseFrequency: "2" },
      { stageStart: "7", priceCeilingIncreaseFrequency: "0" },
    ]);
    expect(compiled(input).map((stage) => Number(stage.startsAtOrAfter))).toEqual([
      firstStart,
      firstStart + 1.5 * DAY,
      firstStart + 1.5 * DAY + 8 * DAY,
    ]);
  });
});
