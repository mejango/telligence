import { IssuanceLadder } from "@/app/[slug]/components/v6/terms/IssuanceLadder";
import type { ChartStage } from "@/app/[slug]/components/v6/terms/chartUtils";
import { Button } from "@/components/ui/button";
import {
  Lock as LockClosedIcon,
  SquarePen as PencilSquareIcon,
  Plus as PlusIcon,
  Trash2 as TrashIcon,
} from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FieldArray } from "@/lib/forms";
import { commaNumber } from "@/lib/number";
import { formatTokenSymbol } from "@/lib/utils";
import { useMemo } from "react";
import { parseUnits } from "viem";
import { getCurrentStageDuration, getResolvedIssuance } from "../helpers/calculatePickupIssuance";
import { AddStageDialog } from "./AddStageDialog";
import { useCreateForm } from "./useCreateForm";

export function Stages({ disabled = false }: { disabled?: boolean }) {
  const { values, revnetTokenSymbol, issuanceBaseCurrencySymbol } = useCreateForm();

  // Pinned at mount so stage 1's start never drifts past the ladder's own "now".
  const chartNow = useMemo(() => Math.floor(Date.now() / 1000), []);
  // The stages as chart input, mirroring parseDeployData's start and cut math.
  const chartStages: ChartStage[] = [];
  values.stages.forEach((stage, index) => {
    const futureStart = Number(values.stages[0].futureStartTimestamp);
    const start =
      index === 0
        ? futureStart > 0
          ? futureStart
          : chartNow
        : chartStages[index - 1].start +
          Number(getCurrentStageDuration(stage, values.stages[index - 1])) * 86_400;
    let weight = 0n;
    try {
      weight = parseUnits(stage.initialIssuance || "0", 18);
    } catch {}
    chartStages.push({
      start,
      duration: Math.floor(Number(stage.priceCeilingIncreaseFrequency) * 86_400) || 0,
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
          <span className="capitalize">{revnetTokenSymbol}</span> issuance and cash out terms evolve
          over time automatically in stages.
        </p>
        <p className="text-zinc-600 text-lg mt-2">Staged terms can't be edited once deployed.</p>
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
                              <TrashIcon className="h-4 w-4" />
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
                        <dt className="font-medium">Paid Issuance</dt>
                        <dd>
                          {getResolvedIssuance(stage, index, values.stages)}{" "}
                          {formatTokenSymbol(values.tokenSymbol) ?? "tokens"} /{" "}
                          {issuanceBaseCurrencySymbol}
                          {stage.pickUpFromPrevious && index > 0 && (
                            <span className="text-xs text-gray-500 italic"> (pickup)</span>
                          )}
                          {Number(stage.priceCeilingIncreasePercentage) > 0 &&
                            Number(stage.priceCeilingIncreaseFrequency) > 0 &&
                            ` cut ${stage.priceCeilingIncreasePercentage}% every ${stage.priceCeilingIncreaseFrequency} days`}
                          {(() => {
                            const splitSum = stage.splits.reduce(
                              (sum, split) => sum + (Number(split.percentage) || 0),
                              0,
                            );
                            return splitSum === 0 ? "" : `, ${splitSum}% split limit`;
                          })()}
                        </dd>
                        <dt className="font-medium">Auto issuance</dt>
                        <dd>
                          {stage.autoIssuance.reduce(
                            (sum, autoIssuance) => sum + (Number(autoIssuance.amount) || 0),
                            0,
                          ) === 0
                            ? "none"
                            : `${commaNumber(stage.autoIssuance.reduce((sum, autoIssuance) => sum + (Number(autoIssuance.amount) || 0), 0))} ${formatTokenSymbol(values.tokenSymbol) ?? "tokens"} auto issuance`}
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
                  Preview {formatTokenSymbol(values.tokenSymbol) ?? "token"} issuance price over
                  time with the above stages:
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
