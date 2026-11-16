"use client";

import { chainDisplayName } from "@/app/constants";
import { Field } from "@/app/create/form/Fields";
import { ChainLogo } from "@/components/ChainLogo";
import { PermissionStatus } from "@/components/PermissionStatus";
import { StickyGroupFields } from "@/components/sticky/StickyGroupFields";
import { StickyRecipient } from "@/components/sticky/StickyRecipient";
import { StickyTokenStatus } from "@/components/sticky/StickyTokenStatus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { X as XIcon } from "@/components/ui/icons";
import { SummaryRow, TxProgress } from "@/components/ui/TxProgress";
import { toast } from "@/components/ui/use-toast";
import { WalletConnectButton } from "@/components/WalletButton";
import { useUserPermissions } from "@/hooks/useUserPermissions";
import { FieldArray, Form, FormProvider } from "@/lib/forms";
import { withSchema } from "@/lib/formValidation";
import { hasSuckerPair, isPairCheckPending, unverifiedPairLine } from "@/lib/nana/suckers";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { SAFE_PROPOSAL_UNCONFIRMED_LINE } from "@/lib/reviewed-call";
import {
  isStickyHook,
  isStickyRow,
  stickyGroupDraft,
  stickyGroupOf,
  stickyRecipientLabel,
  stickySplitsProblem,
  stickyUnavailableReason,
  type StickyGroupDraft,
} from "@/lib/sticky";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JBChainId, SPLITS_TOTAL_PERCENT } from "@bananapus/nana-sdk-core";
import { useEffect, useMemo, useState } from "react";
import { Address, zeroAddress, type PublicClient } from "viem";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { changeSplitsSchema } from "./changeSplitsSchema";
import { useChainSplits } from "./hooks/useChainSplits";
import { stickySplitGroupId, useSetSplitGroups } from "./hooks/useSetSplitGroups";
import { emptySaveBlockMessage } from "./splitsLib";

/**
 * A row in the editor. `percentage` and `beneficiary` are what the form edits;
 * the rest is carried verbatim from the on-chain `JBSplit` so a save can't
 * silently drop a split's hook, project routing, or lock. Rows the user adds
 * have none of it — a plain address payout, or Sticky holders (`kind` "hook",
 * `hookKind` "sticky": `beneficiary` is the Sticky token and the group fields
 * pick who).
 */
export type SplitFormData = {
  percentage: string;
  beneficiary: string;
  projectId?: bigint;
  hook?: Address;
  lockedUntil?: number;
  preferAddToBalance?: boolean;
  kind?: "address" | "hook";
  hookKind?: "sticky";
} & Partial<StickyGroupDraft>;

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
  if (isStickyRow(split)) return null;
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
  /** For a panel that would otherwise sit empty when the account can't edit. */
  deniedNote?: string;
};

export function ChangeSplitRecipientsDialog(props: Props) {
  const { stageIdx, initialChainId, splitLimit, triggerVariant = "outline", deniedNote } = props;
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState<ChainFormData[] | null>(null);
  // A multi-chain change stopped at a Safe proposal: nothing more to send from here.
  const [proposal, setProposal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { address } = useAccount();

  const permissions = useUserPermissions();
  const { hasPermission } = permissions;
  const { chainSplits, verifiedPairs, suckerCheck, refetch } = useChainSplits(stageIdx);

  const {
    submitSplits,
    isSubmitting,
    isPending,
    isTxLoading,
    isSafeProposal,
    isTxUnconfirmed,
    isTxReceiptUnconfirmed,
    txHeldLine,
    relayrAvailable,
  } = useSetSplitGroups({
    onSuccess: (txHash) => {
      console.debug(`Transaction confirmed: ${txHash}`);
      toast({ title: "Splits updated successfully" });
      setReviewing(null);
      setOpen(false);
      setTimeout(refetch, 4000); // Give it some time to index data
    },
  });

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
        // A Sticky split's projectId is its holder group, never a project.
        ...(isStickyHook(split.hook, chainData.chainId)
          ? {
              kind: "hook" as const,
              hookKind: "sticky" as const,
              ...stickyGroupDraft(split.projectId),
            }
          : {}),
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
      (chainId) => chainDisplayName(chainId),
    );

  // Each chain's project id is written into the call, so it must be a pair the
  // on-chain sucker registry lists, not only the indexer.
  const unverifiedChain = (chains: ChainFormData[]) =>
    chains.find(
      (chain) =>
        !hasSuckerPair(verifiedPairs, { peerChainId: chain.chainId, projectId: chain.projectId }),
    );

  const [stickyProblem, setStickyProblem] = useState<string | null>(null);
  const handleSubmit = async (values: FormData) => {
    // Permission can come from a viewed account. The confirm sends from the
    // connected wallet and cannot connect one, so it opens only once one is.
    if (!address) return;
    const selectedChains = values.chains.filter((c) => c.selected);
    if (selectedChains.length === 0) {
      console.error("No chains selected");
      return;
    }
    if (blockMessageFor(values.chains)) return;
    if (unverifiedChain(selectedChains)) return;
    // The distributor never reverts, so an unregistered token would quietly pay group 0.
    // Check every Sticky token on the chain it is saved to before anything is signed.
    setStickyProblem(null);
    try {
      for (const chain of selectedChains) {
        const sticky = chain.splits.filter(isStickyRow).map((split) => ({
          beneficiary: split.beneficiary as Address,
          projectId: stickySplitGroupId(split),
        }));
        if (sticky.length === 0) continue;
        const client = getPublicClient(wagmiConfig, { chainId: chain.chainId }) as PublicClient;
        const problem = await stickySplitsProblem(sticky, [chain.chainId], () => client);
        if (problem) {
          setStickyProblem(problem);
          return;
        }
      }
    } catch (error) {
      setStickyProblem(
        error instanceof Error ? error.message : "Could not check the Sticky tokens.",
      );
      return;
    }
    setProposal(null);
    setReviewing(selectedChains);
  };

  const confirmSubmit = async () => {
    if (!reviewing) return;
    // Back to the form, which names the pair that is no longer chain-verified.
    if (unverifiedChain(reviewing)) {
      setReviewing(null);
      return;
    }
    setFailure(null);
    const result = await submitSplits(reviewing, [
      { label: "Stage", value: String(stageIdx + 1) },
      ...reviewing.map((chain) => ({
        label: chainNameOf(chain.chainId),
        value:
          chain.splits.length === 0
            ? "No recipients"
            : `${chain.splits.length} recipient${chain.splits.length === 1 ? "" : "s"}`,
        lines: chain.splits.map((split) => {
          const routing = splitRouting(split);
          const to = isStickyRow(split)
            ? stickyRecipientLabel({
                projectId: stickySplitGroupId(split),
                beneficiary: split.beneficiary as Address,
              })
            : routing
              ? routing.kind === "hook"
                ? `split hook ${routing.address}`
                : `project #${routing.projectId}`
              : split.beneficiary;
          return `${trimTrailingZeros(Number(split.percentage).toFixed(7))}% to ${to}`;
        }),
      })),
    ]);
    if (result?.closed) {
      setReviewing(null);
      return;
    }
    if (result?.proposal) setProposal(result.proposal);
    if (result?.error) setFailure(result.error);
    if (result?.success && reviewing.length > 1) setReviewing(null);
  };

  const writing = isSubmitting || isPending || isTxLoading;
  // A change proposed to the Safe, on one chain or at the first of several,
  // waits on its signers, not on a receipt here, so the confirm ends on Done.
  const proposed = Boolean(isSafeProposal) || proposal !== null;
  // A single-chain change whose watch ended without a receipt may still land:
  // the confirm ends on Done and Save stays locked.
  const unconfirmed = Boolean(isTxReceiptUnconfirmed);
  // So may a Safe proposal whose result can't be confirmed: Save stays locked.
  const saveLocked = unconfirmed || Boolean(isTxUnconfirmed);
  const relayed =
    relayrAvailable &&
    (reviewing?.length ?? 0) > 1 &&
    areRelayrChainsCompatible(reviewing?.map((chain) => chain.chainId) ?? []);
  const chainNameOf = (chainId: JBChainId) => chainDisplayName(chainId);

  if (!hasPermission("SET_SPLIT_GROUPS")) {
    return <PermissionStatus {...permissions} deniedNote={deniedNote} />;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>Change split recipients</Button>
      </DialogTrigger>
      {reviewing ? (
        <TxProgress
          open
          onClose={() => {
            setReviewing(null);
            setProposal(null);
            setFailure(null);
          }}
          title="Confirm split recipients"
          steps={
            relayed
              ? [
                  {
                    title: "Sign the authorization",
                    detail: "Sign one exact authorization for each selected chain.",
                  },
                  {
                    title: "Pay the relay fee",
                    detail: "Choose a funding chain and pay once to update each chain.",
                  },
                ]
              : reviewing.map((chain) => ({
                  title: `Update the recipients on ${chainNameOf(chain.chainId)}`,
                }))
          }
          activeIndex={writing && !proposed ? 0 : -1}
          start={() => void confirmSubmit()}
          busy={writing && !proposed}
          complete={proposed || unconfirmed}
          error={failure}
          status={
            proposal ??
            (isTxUnconfirmed
              ? SAFE_PROPOSAL_UNCONFIRMED_LINE
              : proposed
                ? "Proposed to Safe. Approve and execute it there."
                : (txHeldLine ?? (unconfirmed ? "Couldn't confirm the change yet." : null)))
          }
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
                        {isStickyRow(split) ? (
                          <StickyRecipient
                            split={{
                              projectId: stickySplitGroupId(split),
                              beneficiary: split.beneficiary as Address,
                            }}
                            chainId={chain.chainId}
                          />
                        ) : routing ? (
                          routing.kind === "hook" ? (
                            `split hook ${routing.address}`
                          ) : (
                            `project #${routing.projectId}`
                          )
                        ) : (
                          split.beneficiary
                        )}
                      </span>
                    );
                  })}
                </>
              )}
            </SummaryRow>
          ))}
          {relayed ? <SummaryRow label="Relay fee">Quoted in ETH after you sign</SummaryRow> : null}
        </TxProgress>
      ) : null}
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change split recipients</DialogTitle>
          <p className="text-sm text-zinc-500 mt-2">Stage {stageIdx + 1}</p>
          <p className="text-sm text-zinc-500 mt-1">
            This stage splits {splitLimit ?? "a fixed share"} of new tokens. You can change who
            receives that share, but cannot change its size.
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
            const unverified = unverifiedChain(values.chains.filter((c) => c.selected));
            // While the registry read is in flight Save shows its loading state;
            // a mismatch or failure says so inline.
            const pairPending = !!unverified && isPairCheckPending(suckerCheck);
            const pairLine = unverified
              ? unverifiedPairLine(suckerCheck, chainDisplayName(unverified.chainId))
              : null;
            return (
              <Form>
                <div className="space-y-6 mt-4">
                  {values.chains.length > 1 && (
                    <div>
                      <div className="text-sm font-semibold mb-2">Chains to update</div>
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
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
                      <div className="space-y-4">
                        {values.chains.map((chain, chainIdx) => {
                          if (!chain.selected) return null;

                          const totalPercentage = chain.splits.reduce(
                            (sum, s) => sum + (Number(s.percentage) || 0),
                            0,
                          );

                          return (
                            <div
                              key={chain.chainId}
                              className="border-t border-zinc-200 pt-4 first:border-t-0 first:pt-0"
                            >
                              <div className="flex items-center gap-2">
                                <ChainLogo chainId={chain.chainId} width={24} height={24} />
                                <h3 className="text-md font-semibold">
                                  {chainDisplayName(chain.chainId)}
                                </h3>
                              </div>

                              <FieldArray name={`chains.${chainIdx}.splits`}>
                                {(arrayHelpers) => (
                                  <div>
                                    {chain.splits.length === 0 &&
                                      (blockMessageFor([chain]) ? (
                                        <p className="mt-4 text-sm text-red-500">
                                          {blockMessageFor([chain])} Keep at least one recipient, or
                                          clear the default group first.
                                        </p>
                                      ) : (
                                        <p className="mt-4 text-sm text-zinc-500">
                                          No recipients: this chain&apos;s reserved tokens will be
                                          minted to the revnet&apos;s owner contract, where anyone
                                          can burn them.
                                        </p>
                                      ))}
                                    {chain.splits.map((split, splitIdx) => {
                                      const routing = splitRouting(split);
                                      const locked = splitIsLocked(split, nowSeconds);
                                      const sticky = isStickyRow(split);
                                      // Sticky is a hook type, offered where this chain has the distributor.
                                      const stickyReason = stickyUnavailableReason([chain.chainId]);
                                      const rowName = `chains.${chainIdx}.splits.${splitIdx}`;
                                      return (
                                        <div key={splitIdx}>
                                          <div className="mt-4 flex flex-wrap items-start gap-2 text-md text-zinc-600">
                                            <label
                                              className="flex h-9 items-center whitespace-nowrap"
                                              htmlFor={`${rowName}.percentage`}
                                            >
                                              {splitIdx === 0 ? "Split" : "... and"}
                                            </label>
                                            <Field
                                              id={`${rowName}.percentage`}
                                              name={`${rowName}.percentage`}
                                              type="number"
                                              min="0"
                                              max="100"
                                              step="0.01"
                                              className="h-9 pr-8 pl-2"
                                              width="w-28 shrink-0"
                                              suffix="%"
                                              required
                                            />
                                            <span className="flex h-9 items-center">to</span>
                                            {!routing && !locked ? (
                                              <select
                                                aria-label="Recipient type"
                                                value={sticky ? "hook" : "address"}
                                                onChange={(e) =>
                                                  setFieldValue(rowName, {
                                                    percentage: split.percentage,
                                                    beneficiary: "",
                                                    ...(e.target.value === "hook"
                                                      ? {
                                                          kind: "hook",
                                                          hookKind: "sticky",
                                                          ...stickyGroupOf({}),
                                                        }
                                                      : {}),
                                                  })
                                                }
                                                className="h-9 border-2 border-melon-300 bg-melon-25 px-2 py-0 pr-8 text-md hover:border-melon-400 focus:border-melon-600 focus:outline-none focus:ring-0"
                                              >
                                                <option value="address">Address</option>
                                                {!stickyReason || sticky ? (
                                                  <option value="hook">Hook</option>
                                                ) : null}
                                              </select>
                                            ) : null}
                                            {/* Phones keep the remove button on the row's first line. */}
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => arrayHelpers.remove(splitIdx)}
                                              className="ml-auto h-9 shrink-0 px-0 sm:order-last sm:ml-0 sm:px-3"
                                              aria-label="Remove split"
                                              disabled={locked}
                                              title={
                                                locked
                                                  ? "Locked until this stage's lock expires"
                                                  : undefined
                                              }
                                            >
                                              <XIcon className="h-4 w-4" />
                                            </Button>
                                            {sticky && !locked ? (
                                              <span className="flex h-9 items-center">Sticky</span>
                                            ) : null}
                                            {sticky && locked ? (
                                              <div className="min-w-40 flex-1 py-2 text-sm break-all max-sm:basis-full">
                                                <StickyRecipient
                                                  split={{
                                                    projectId: stickySplitGroupId(split),
                                                    beneficiary: split.beneficiary as Address,
                                                  }}
                                                  chainId={chain.chainId}
                                                />{" "}
                                                (locked)
                                              </div>
                                            ) : routing ? (
                                              <div className="min-w-40 flex-1 py-2 text-sm break-all max-sm:basis-full">
                                                {routing.kind === "hook"
                                                  ? `split hook ${routing.address}`
                                                  : `project #${routing.projectId}`}
                                                {locked && " (locked)"}
                                              </div>
                                            ) : (
                                              <div
                                                className={`flex min-w-40 flex-1 flex-col gap-2 ${
                                                  sticky ? "" : "max-sm:basis-full"
                                                }`}
                                              >
                                                <Field
                                                  name={`${rowName}.beneficiary`}
                                                  type="text"
                                                  aria-label={sticky ? "Sticky token" : undefined}
                                                  className="h-9"
                                                  width="w-full min-w-0"
                                                  placeholder={
                                                    sticky ? "0x… (Sticky token)" : "0x..."
                                                  }
                                                  required
                                                />
                                              </div>
                                            )}
                                          </div>
                                          {sticky && !locked && stickyReason ? (
                                            <p role="alert" className="mt-2 text-sm text-red-500">
                                              {stickyReason}
                                            </p>
                                          ) : sticky && !locked ? (
                                            <>
                                              <StickyGroupFields
                                                value={stickyGroupOf(split)}
                                                onChange={(patch) =>
                                                  setFieldValue(rowName, { ...split, ...patch })
                                                }
                                              />
                                              <StickyTokenStatus
                                                row={{
                                                  ...stickyGroupOf(split),
                                                  token: split.beneficiary,
                                                }}
                                                chainIds={[chain.chainId]}
                                              />
                                            </>
                                          ) : null}
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
                                      className="mt-4"
                                    >
                                      Add split +
                                    </Button>

                                    {chain.splits.length > 0 && (
                                      <div
                                        className={`mt-3 text-sm ${
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

                {pairLine ? <p className="mt-4 text-sm text-zinc-600">{pairLine}</p> : null}
                {stickyProblem ? (
                  <p role="alert" className="mt-4 text-sm text-red-600">
                    {stickyProblem}
                  </p>
                ) : null}
                {isTxUnconfirmed ? (
                  <p className="mt-4 text-sm text-zinc-600">{SAFE_PROPOSAL_UNCONFIRMED_LINE}</p>
                ) : null}
                <DialogFooter className="mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={isSubmitting || isPending || isTxLoading}
                  >
                    Cancel
                  </Button>
                  {address ? (
                    <Button
                      type="submit"
                      disabled={
                        !isValid ||
                        !!emptySaveBlock ||
                        !!unverified ||
                        isSubmitting ||
                        isPending ||
                        isTxLoading ||
                        saveLocked
                      }
                      loading={isSubmitting || isPending || isTxLoading || pairPending}
                      className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                    >
                      Save changes
                    </Button>
                  ) : (
                    <WalletConnectButton className="bg-teal-500 text-melon-950 hover:bg-teal-600" />
                  )}
                </DialogFooter>
              </Form>
            );
          }}
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
