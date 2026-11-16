import { IssuanceLadder } from "@/app/[slug]/components/v6/terms/IssuanceLadder";
import type { ChartStage } from "@/app/[slug]/components/v6/terms/chartUtils";
import { Button } from "@/components/ui/button";
import {
  Lock as LockClosedIcon,
  SquarePen as PencilSquareIcon,
  Plus as PlusIcon,
  X as XIcon,
} from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatShortDateTime } from "@/lib/date";
import { FieldArray } from "@/lib/forms";
import { commaNumber } from "@/lib/number";
import { formatTokenSymbol } from "@/lib/utils";
import { useMemo } from "react";
import { parseUnits } from "viem";
import {
  getCurrentStageDuration,
  getResolvedIssuance,
  getStageCutFrequencySeconds,
  getStageStarts,
} from "../helpers/calculatePickupIssuance";
import { AddStageDialog } from "./AddStageDialog";
import { useCreateForm } from "./useCreateForm";

export function Stages({ disabled = false }: { disabled?: boolean }) {
  const { values, revnetTokenSymbol, issuanceBaseCurrencySymbol } = useCreateForm();

  // Pin preparation time so the chart does not drift while editing terms.
  const chartNow = useMemo(() => Math.floor(Date.now() / 1000), []);
  const starts = getStageStarts(values.stages, chartNow);
  const chartStages: ChartStage[] = [];
  values.stages.forEach((stage, index) => {
    let weight = 0n;
    try {
      weight = parseUnits(stage.initialIssuance || "0", 18);
    } catch {}
    chartStages.push({
      start: starts[index],
      duration: getStageCutFrequencySeconds(stage),
      weight,
      weightCutPercent: Math.round((Number(stage.priceCeilingIncreasePercentage) || 0) * 1e7),
      inheritsWeight: Boolean(stage.pickUpFromPrevious) && index > 0,
    });
  });

  const getDynamicDuration = (currentStageIndex: number): number => {
    if (currentStageIndex >= values.stages.length - 1) {
      return 0; // Last stage is forever
    }

    const nextStage = values.stages[currentStageIndex + 1];
    const currentStage = values.stages[currentStageIndex];

    const duration = getCurrentStageDuration(nextStage, currentStage);
    return Number(duration);
  };
  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">3. Terms</h2>
        <p className="text-zinc-600 text-lg">
          Set how many {revnetTokenSymbol} payments create and how much holders receive when they
          cash out. These terms change automatically on the schedule you choose, in stages.
        </p>
        <p className="text-zinc-600 text-lg mt-2">You cannot edit the stages after launch.</p>
      </div>
      <FieldArray
        name="stages"
        render={(arrayHelpers) => (
          <div className="col-span-2 mt-6 mb-4 md:mt-0">
            {values.stages.length > 0 ? (
              <div className="divide-y mb-2">
                {values.stages.map((stage, index) => {
                  const duration = getDynamicDuration(index);
                  return (
                    // Leading padding on the first card would drop it below the
                    // section heading, which every other section's first field
                    // lines up with. Between-card spacing keeps both halves.
                    <div
                      className={index === 0 ? "pb-4" : "py-4"}
                      key={`${stage.stageStart}-${duration}`}
                    >
                      <div className="mb-1 flex justify-between items-center">
                        <div className="font-semibold">Stage {index + 1}</div>
                        <div className="flex">
                          <AddStageDialog
                            stageIdx={index}
                            initialValues={stage}
                            onSave={(newStage) => {
                              arrayHelpers.replace(index, newStage);
                            }}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              aria-label={`Edit stage ${index + 1}`}
                            >
                              {disabled ? null : <PencilSquareIcon className="h-4 w-4" />}
                            </Button>
                          </AddStageDialog>

                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => arrayHelpers.remove(index)}
                          >
                            {disabled ? (
                              <LockClosedIcon className="h-4 w-4" />
                            ) : (
                              <XIcon className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <dl className="text-md text-zinc-600 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                        <dt className="font-medium">Duration</dt>
                        <dd>
                          {duration === 0 ? (
                            <Tooltip>
                              <TooltipTrigger className="underline decoration-dotted cursor-help">
                                Forever
                              </TooltipTrigger>
                              <TooltipContent>Add another stage to change it</TooltipContent>
                            </Tooltip>
                          ) : (
                            `${duration} days`
                          )}
                        </dd>
                        {stage.futureStartTimestamp !== undefined && index === 0 ? (
                          <>
                            <dt className="font-medium">Starts</dt>
                            <dd>
                              {stage.futureStartTimestamp === null ? (
                                <span className="text-red-700">Choose a start date and time</span>
                              ) : (
                                formatShortDateTime(stage.futureStartTimestamp * 1000)
                              )}
                            </dd>
                          </>
                        ) : null}
                        <dt className="font-medium">Tokens per payment</dt>
                        <dd>
                          {getResolvedIssuance(stage, index, values.stages)}{" "}
                          {formatTokenSymbol(values.tokenSymbol) ?? "tokens"} /{" "}
                          {issuanceBaseCurrencySymbol}
                          {stage.pickUpFromPrevious && index > 0 && (
                            <span className="text-xs text-gray-500 italic">
                              {" "}
                              (continued from previous stage)
                            </span>
                          )}
                          {Number(stage.priceCeilingIncreasePercentage) > 0 &&
                            Number(stage.priceCeilingIncreaseFrequency) > 0 &&
                            ` cut ${stage.priceCeilingIncreasePercentage}% every ${stage.priceCeilingIncreaseFrequency} days`}
                          {(() => {
                            const splitSum = stage.splits.reduce(
                              (sum, split) => sum + (Number(split.percentage) || 0),
                              0,
                            );
                            return splitSum === 0 ? "" : `, ${splitSum}% set aside`;
                          })()}
                        </dd>
                        <dt className="font-medium">Tokens at stage start</dt>
                        <dd>
                          {stage.autoIssuance.reduce(
                            (sum, autoIssuance) => sum + (Number(autoIssuance.amount) || 0),
                            0,
                          ) === 0
                            ? "none"
                            : `${commaNumber(stage.autoIssuance.reduce((sum, autoIssuance) => sum + (Number(autoIssuance.amount) || 0), 0))} ${formatTokenSymbol(values.tokenSymbol) ?? "tokens"} at stage start`}
                        </dd>
                        <dt className="font-medium">Cash out tax</dt>
                        <dd>{Number(stage.priceFloorTaxIntensity) / 100 || 0}</dd>
                      </dl>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-left text-black-500 font-semibold mb-4">Add stages</div>
            )}

            <AddStageDialog
              stageIdx={values.stages.length}
              onSave={(newStage) => {
                arrayHelpers.push(newStage);
              }}
            >
              <Button
                className="flex gap-1 border border-dashed border-zinc-400"
                variant="secondary"
                disabled={disabled}
              >
                Add stage <PlusIcon className="h-3 w-3" />
              </Button>
            </AddStageDialog>
            {chartStages.some((stage) => stage.weight > 0n || stage.inheritsWeight) ? (
              <div className="mt-6">
                <p className="text-sm text-zinc-500">
                  Preview the price to create {formatTokenSymbol(values.tokenSymbol) ?? "tokens"}{" "}
                  over time. Market prices can differ:
                </p>
                <div className="mt-2 border border-zinc-200 p-4">
                  <IssuanceLadder
                    stages={chartStages}
                    symbol={formatTokenSymbol(values.tokenSymbol) ?? "tokens"}
                    baseSymbol={issuanceBaseCurrencySymbol}
                    defaultYears={91 / 365}
                    viewHeight={70}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      />
    </>
  );
}
