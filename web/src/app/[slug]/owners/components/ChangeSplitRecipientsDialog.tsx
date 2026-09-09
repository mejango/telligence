"use client";

import { chainDisplayName } from "@/app/constants";
import { Field } from "@/app/create/form/Fields";
import { ChainLogo } from "@/components/ChainLogo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Trash2 as TrashIcon } from "@/components/ui/icons";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { toast } from "@/components/ui/use-toast";
import { useUserPermissions } from "@/hooks/useUserPermissions";
import { FieldArray, Form, FormProvider } from "@/lib/forms";
import { withSchema } from "@/lib/formValidation";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { JB_CHAINS, JBChainId, SPLITS_TOTAL_PERCENT } from "@bananapus/nana-sdk-core";
import { useEffect, useMemo, useState } from "react";
import { Address, zeroAddress } from "viem";
import { changeSplitsSchema } from "./changeSplitsSchema";
import { useChainSplits } from "./hooks/useChainSplits";
import { useSetSplitGroups } from "./hooks/useSetSplitGroups";
import { emptySaveBlockMessage } from "./splitsLib";

/**
 * A row in the editor. `percentage` and `beneficiary` are what the form edits;
 * the rest is carried verbatim from the on-chain `JBSplit` so a save can't
 * silently drop a split's hook, project routing, or lock. Rows the user adds
 * have none of it — a plain address payout.
 */
export type SplitFormData = {
  percentage: string;
  beneficiary: string;
  projectId?: bigint;
  hook?: Address;
  lockedUntil?: number;
  preferAddToBalance?: boolean;
};

export type ChainFormData = {
  chainId: JBChainId;
  projectId: bigint;
  rulesetId: bigint;
  splits: SplitFormData[];
  selected: boolean;
};

/** Splits routed by a hook or into another project aren't plain address payouts. */
/** `33.3333333` not `33.3333333000`, and `50` not `50.0000000`. */
function trimTrailingZeros(fixed: string): string {
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

export function splitRouting(split: SplitFormData) {
  if (split.hook && split.hook !== zeroAddress)
    return { kind: "hook", address: split.hook } as const;
  if (split.projectId) return { kind: "project", projectId: split.projectId } as const;
  return null;
}

/** A lock the chain still honors — `JBSplits` rejects any save that drops or shortens it. */
export function splitIsLocked(split: SplitFormData, nowSeconds: number) {
  return (split.lockedUntil ?? 0) > nowSeconds;
}

type FormData = {
  chains: ChainFormData[];
};

type Props = {
  /** The stage's INDEX in the chronological ruleset list — each chain has its own ruleset id for it. */
  stageIdx: number;
  initialChainId: JBChainId;
  splitLimit?: string;
  triggerVariant?: "default" | "outline" | "secondary";
};

export function ChangeSplitRecipientsDialog(props: Props) {
  const { stageIdx, initialChainId, splitLimit, triggerVariant = "outline" } = props;
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState<ChainFormData[] | null>(null);

  const { hasPermission } = useUserPermissions();
  const { chainSplits, refetch } = useChainSplits(stageIdx);

  const { submitSplits, isSubmitting, isPending, isTxLoading, relayrAvailable } = useSetSplitGroups(
    {
      onSuccess: (txHash) => {
        console.debug(`Transaction confirmed: ${txHash}`);
        toast({ title: "Splits updated successfully" });
        setReviewing(null);
        setOpen(false);
        setTimeout(refetch, 4000); // Give it some time to index data
      },
    },
  );

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  const initialValues = useMemo((): FormData => {
    const chains = chainSplits.map((chainData): ChainFormData => ({
      chainId: chainData.chainId,
      projectId: BigInt(chainData.projectId),
      rulesetId: BigInt(chainData.rulesetId),
      selected: chainData.chainId === initialChainId,
      splits: chainData.splits.map((split) => ({
        // Seven decimals, because a share is stored out of 1e9 — two decimals turned three
        // equal thirds into 33.33 × 3 = 99.99%, which the 100% rule then rejected, leaving a
        // legitimate on-chain config unsaveable until hand-edited.
        percentage: trimTrailingZeros(
          ((Number(split.percent) / SPLITS_TOTAL_PERCENT) * 100).toFixed(7),
        ),
        beneficiary: split.beneficiary,
        projectId: split.projectId,
        hook: split.hook,
        lockedUntil: split.lockedUntil,
        preferAddToBalance: split.preferAddToBalance,
      })),
    }));

    return { chains };
  }, [chainSplits, initialChainId]);

  // `JBSplits.splitsOf` serves the fallback (ruleset 0) group whenever a ruleset's
  // group is empty, so clearing a chain's recipients only strands the reserved
  // tokens at the owner contract when that chain's fallback group is empty too.
  const fallbackCountByChain = useMemo(
    () => new Map(chainSplits.map((chain) => [chain.chainId, chain.fallbackSplitCount])),
    [chainSplits],
  );

  // Read once per open: a lock expiring mid-edit shouldn't reshuffle the form.
  const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockMessageFor = (chains: ChainFormData[]) =>
    emptySaveBlockMessage(
      chains.map((chain) => ({
        chainId: chain.chainId,
        selected: chain.selected,
        splitCount: chain.splits.length,
        fallbackSplitCount: fallbackCountByChain.get(chain.chainId) ?? null,
      })),
      (chainId) => JB_CHAINS[chainId as JBChainId]?.name ?? `chain ${chainId}`,
    );

  const handleSubmit = async (values: FormData) => {
    const selectedChains = values.chains.filter((c) => c.selected);
    if (selectedChains.length === 0) {
      console.error("No chains selected");
      return;
    }
    if (blockMessageFor(values.chains)) return;
    setReviewing(selectedChains);
  };

  const confirmSubmit = async () => {
    if (!reviewing) return;
    const result = await submitSplits(reviewing);
    if (result?.success && reviewing.length > 1) setReviewing(null);
  };

  const writing = isSubmitting || isPending || isTxLoading;
  const relayed =
    relayrAvailable &&
    (reviewing?.length ?? 0) > 1 &&
    areRelayrChainsCompatible(reviewing?.map((chain) => chain.chainId) ?? []);
  const chainNameOf = (chainId: JBChainId) => JB_CHAINS[chainId]?.name ?? `chain ${chainId}`;

  if (!hasPermission("SET_SPLIT_GROUPS")) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>Change split recipients</Button>
      </DialogTrigger>
      {reviewing ? (
        <TxConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setReviewing(null);
          }}
          title="Confirm split recipients"
          chainId={reviewing[0].chainId}
          steps={
            relayed
              ? [
                  {
                    title: "Sign the authorization",
                    detail: "Sign one exact authorization for each selected chain.",
                  },
                  {
                    title: "Pay the relay fee",
                    detail: "Choose a funding chain and pay once. Relayr updates each chain.",
                  },
                ]
              : reviewing.map((chain) => ({
                  title: `Update the recipients on ${chainNameOf(chain.chainId)}`,
                }))
          }
          activeIndex={writing ? 0 : -1}
          action="Save changes"
          onConfirm={() => void confirmSubmit()}
          busy={writing}
        >
          <SummaryRow label="Stage">{stageIdx + 1}</SummaryRow>
          {reviewing.map((chain) => (
            <SummaryRow key={chain.chainId} label={chainNameOf(chain.chainId)}>
              {chain.splits.length === 0 ? (
                "No recipients"
              ) : (
                <>
                  {chain.splits.length} recipient{chain.splits.length === 1 ? "" : "s"}
                  {chain.splits.map((split, index) => {
                    const routing = splitRouting(split);
                    return (
                      <span key={index} className="block text-xs text-zinc-500">
                        {trimTrailingZeros(Number(split.percentage).toFixed(7))}% to{" "}
                        {routing
                          ? routing.kind === "hook"
                            ? `split hook ${routing.address}`
                            : `project #${routing.projectId}`
                          : split.beneficiary}
                      </span>
                    );
                  })}
                </>
              )}
            </SummaryRow>
          ))}
          {relayed ? <SummaryRow label="Relay fee">Quoted in ETH after you sign</SummaryRow> : null}
        </TxConfirmDialog>
      ) : null}
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change split recipients</DialogTitle>
          <p className="text-sm text-zinc-500 mt-2">Stage {stageIdx + 1}</p>
          <p className="text-sm text-zinc-500 mt-1">
            The stage always sets aside {splitLimit ? `${splitLimit} of` : "its split percent of"}{" "}
            new issuance — that amount is fixed. Splits only route it, so changing them can&apos;t
            change how much is set aside.
          </p>
        </DialogHeader>

        <FormProvider
          initialValues={initialValues}
          validate={withSchema(changeSplitsSchema)}
          onSubmit={handleSubmit}
          enableReinitialize={!isSubmitting && !isPending && !isTxLoading}
        >
          {({ values, setFieldValue, isValid }) => {
            const emptySaveBlock = blockMessageFor(values.chains);
            return (
              <Form>
                <div className="space-y-6 mt-4">
                  {values.chains.length > 1 && (
                    <div>
                      <div className="text-sm font-semibold mb-2">Select chains to update:</div>
                      <div className="flex flex-wrap gap-6">
                        {values.chains.map((chain, chainIdx) => (
                          <label key={chain.chainId} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={chain.selected}
                              onChange={(e) =>
                                setFieldValue(`chains.${chainIdx}.selected`, e.target.checked)
                              }
                            />
                            {chainDisplayName(chain.chainId)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <FieldArray name="chains">
                    {() => (
                      <div className="space-y-8">
                        {values.chains.map((chain, chainIdx) => {
                          if (!chain.selected) return null;

                          const totalPercentage = chain.splits.reduce(
                            (sum, s) => sum + (Number(s.percentage) || 0),
                            0,
                          );

                          return (
                            <div key={chain.chainId} className="border border-zinc-200 p-4 rounded">
                              <div className="flex items-center gap-2 mb-4">
                                <ChainLogo chainId={chain.chainId} width={24} height={24} />
                                <h3 className="text-md font-semibold">
                                  {chainDisplayName(chain.chainId)}
                                </h3>
                              </div>

                              <FieldArray name={`chains.${chainIdx}.splits`}>
                                {(arrayHelpers) => (
                                  <div className="space-y-3">
                                    {chain.splits.length === 0 &&
                                      (blockMessageFor([chain]) ? (
                                        <p className="text-sm text-red-500">
                                          {blockMessageFor([chain])} Keep at least one recipient, or
                                          clear the default group first.
                                        </p>
                                      ) : (
                                        <p className="text-sm text-zinc-500">
                                          No recipients: this chain&apos;s reserved tokens will be
                                          minted to the revnet&apos;s owner contract, where anyone
                                          can burn them.
                                        </p>
                                      ))}
                                    {chain.splits.map((split, splitIdx) => {
                                      const routing = splitRouting(split);
                                      const locked = splitIsLocked(split, nowSeconds);
                                      return (
                                        <div key={splitIdx} className="flex gap-2 items-start">
                                          <div className="flex-1">
                                            <label className="text-sm text-zinc-600 mb-1 block">
                                              {splitIdx === 0 ? "Split" : "... and"}
                                            </label>
                                            <div className="flex gap-2 items-start">
                                              <Field
                                                name={`chains.${chainIdx}.splits.${splitIdx}.percentage`}
                                                type="number"
                                                min="0"
                                                max="100"
                                                step="0.01"
                                                className="h-9"
                                                width="w-28"
                                                suffix="%"
                                                required
                                              />
                                              <span className="flex items-center text-zinc-600 mt-2">
                                                to
                                              </span>
                                              {routing ? (
                                                <div className="flex-1 mt-2 text-sm text-zinc-600 break-all">
                                                  {routing.kind === "hook"
                                                    ? `split hook ${routing.address}`
                                                    : `project #${routing.projectId}`}
                                                  {locked && " (locked)"}
                                                </div>
                                              ) : (
                                                <Field
                                                  name={`chains.${chainIdx}.splits.${splitIdx}.beneficiary`}
                                                  type="text"
                                                  className="h-9 flex-1"
                                                  placeholder="0x..."
                                                  required
                                                />
                                              )}
                                            </div>
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => arrayHelpers.remove(splitIdx)}
                                            className="mt-6"
                                            aria-label="Remove split"
                                            disabled={locked}
                                            title={
                                              locked
                                                ? "Locked until this stage's lock expires"
                                                : undefined
                                            }
                                          >
                                            <TrashIcon className="size-4" />
                                          </Button>
                                        </div>
                                      );
                                    })}

                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      onClick={() =>
                                        arrayHelpers.push({
                                          percentage: chain.splits.length === 0 ? "100" : "",
                                          beneficiary: "",
                                        })
                                      }
                                      className="mt-2"
                                    >
                                      Add split +
                                    </Button>

                                    {chain.splits.length > 0 && (
                                      <div
                                        className={`text-sm py-1 ${
                                          Math.abs(totalPercentage - 100) < 0.01
                                            ? "text-zinc-500 "
                                            : "text-red-500"
                                        }`}
                                      >
                                        Total: {totalPercentage.toFixed(2)}%
                                        {Math.abs(totalPercentage - 100) >= 0.01 &&
                                          " (must equal 100%)"}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </FieldArray>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </FieldArray>
                </div>

                <DialogFooter className="mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={isSubmitting || isPending || isTxLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      !isValid || !!emptySaveBlock || isSubmitting || isPending || isTxLoading
                    }
                    loading={isSubmitting || isPending || isTxLoading}
                    className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                  >
                    Save changes
                  </Button>
                </DialogFooter>
              </Form>
            );
          }}
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
