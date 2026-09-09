"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import { formatWalletError } from "@/lib/utils";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Address, formatUnits } from "viem";
import { useAccount } from "wagmi";
import { type ChainProject, chainName, chainProjectsKey } from "./lib";
import {
  type PayoutOption,
  buildPayoutCall,
  fetchPayoutOptions,
  payoutAmount,
  payoutCurrencyLabel,
  payoutRecipients,
  payoutTokenAmount,
  readPayoutOptions,
} from "./payouts";

type ReviewedPayout = {
  account: Address;
  destinations: { option: PayoutOption; call: ReturnType<typeof buildPayoutCall> }[];
};

function defaultMinimum(option: PayoutOption, amount: string): string {
  try {
    const expected = payoutTokenAmount(option, payoutAmount(amount, option.decimals));
    const minimum = (expected * 99n) / 100n;
    return formatUnits(minimum > 0n ? minimum : 1n, option.decimals);
  } catch {
    return "";
  }
}

/** Permissionless or ruleset-authorized payouts to each chain's existing recipients. */
export function PayoutsCard({ chains }: { chains: ChainProject[] }) {
  const { address } = useAccount();
  const { runBatch, getPendingBatch } = useMultichainBatch();
  const scope = `payouts:${chainProjectsKey(chains)}`;
  const pending = getPendingBatch(scope);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [minimums, setMinimums] = useState<Record<string, string>>({});
  const [review, setReview] = useState<ReviewedPayout | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    data = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["v6Payouts", chainProjectsKey(chains)],
    enabled: chains.length > 0,
    staleTime: 30_000,
    queryFn: () => fetchPayoutOptions(chains),
  });
  const optionFor = (row: (typeof data)[number]) =>
    row.options.find((option) => option.key === choices[row.chainId]) ??
    row.options.find((option) => option.availableAmount > 0n) ??
    row.options[0];
  const amountFor = (option: PayoutOption) =>
    amounts[option.key] ?? formatUnits(option.availableAmount, option.decimals);
  const minimumFor = (option: PayoutOption) =>
    minimums[option.key] ?? defaultMinimum(option, amountFor(option));

  const buildReview = async () => {
    if (!address || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selectedRows = data.filter((row) => selected.has(row.chainId));
      if (!selectedRows.length) throw new Error("Select at least one chain.");
      const destinations = await Promise.all(
        selectedRows.map(async (row) => {
          const selectedOption = optionFor(row);
          if (!selectedOption || row.error)
            throw new Error(`Payouts could not be verified on ${chainName(row.chainId)}.`);
          const freshOptions = await readPayoutOptions(getViemPublicClient(row.chainId), row);
          const option = freshOptions.find((candidate) => candidate.key === selectedOption.key);
          if (!option)
            throw new Error(
              `Payout settings changed on ${chainName(row.chainId)}. Refresh and review again.`,
            );
          const call = buildPayoutCall(
            option,
            amountFor(selectedOption),
            minimumFor(selectedOption),
            address,
          );
          return { option, call };
        }),
      );
      setReview({ account: address, destinations });
    } catch (failure) {
      setError(formatWalletError(failure) || "Could not review payouts.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (resume = false) => {
    if (!address || busy || (!review && !resume)) return;
    if (!resume && review?.account.toLowerCase() !== address.toLowerCase()) {
      setReview(null);
      setError("Your connected account changed. Review the payouts again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await runBatch({
        label: "Send project payouts",
        scope,
        calls: resume ? [] : review!.destinations.map(({ call }) => call),
        onProgress: setStatus,
      });
      setStatus(
        outcome.status === "success"
          ? "Payout transactions confirmed on all selected chains."
          : "Payouts are pending. Resume the saved batch to check destination progress.",
      );
      setReview(null);
      if (outcome.status === "success") await refetch();
    } catch (failure) {
      setError(formatWalletError(failure) || "Could not send payouts.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-zinc-200 bg-melon-50 p-4">
      <h3 className="font-medium text-zinc-900">Payouts</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Distribute the available payout allowance to each chain&apos;s configured recipients. Any
        unallocated share goes to that chain&apos;s project owner. Protocol fees apply.
      </p>
      {pending ? (
        <div className="mt-3 border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>
            Saved payout progress: {pending.completed}/{pending.total} complete.
          </p>
          <ButtonWithWallet
            disabled={busy}
            loading={busy}
            className="mt-2"
            onClick={() => void submit(true)}
          >
            Resume saved payouts
          </ButtonWithWallet>
        </div>
      ) : null}
      <div className="mt-3 flex gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || Boolean(pending)}
          onClick={() => {
            setSelected(
              new Set(
                data
                  .filter(
                    (row) =>
                      !row.error && row.options.some((option) => option.availableAmount > 0n),
                  )
                  .map((row) => row.chainId),
              ),
            );
          }}
        >
          Select available chains
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>
      {isLoading ? (
        <p className="mt-3 text-sm text-zinc-500">Checking payout limits…</p>
      ) : (
        data.map((row) => {
          const option = optionFor(row);
          const available = option && option.availableAmount > 0n;
          return (
            <div key={row.chainId} className="mt-3 border-t border-zinc-200 pt-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={selected.has(row.chainId)}
                  disabled={busy || Boolean(pending) || Boolean(row.error) || !available}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.chainId);
                      else next.delete(row.chainId);
                      return next;
                    });
                  }}
                />
                <ChainLogo chainId={row.chainId} width={16} height={16} />
                {chainName(row.chainId)} · Project #{String(row.projectId)}
              </label>
              {row.error ? (
                <p className="mt-1 text-sm text-red-600">Could not verify payouts: {row.error}</p>
              ) : !option ? (
                <p className="mt-1 text-sm text-zinc-500">No payout allowance is configured.</p>
              ) : (
                <>
                  {row.options.length > 1 ? (
                    <select
                      aria-label={`Payout asset on ${chainName(row.chainId)}`}
                      className="mt-2 w-full border border-zinc-200 p-2 text-sm"
                      value={option.key}
                      disabled={busy || Boolean(pending)}
                      onChange={(event) =>
                        setChoices((current) => ({ ...current, [row.chainId]: event.target.value }))
                      }
                    >
                      {row.options.map((candidate) => (
                        <option key={candidate.key} value={candidate.key}>
                          {candidate.symbol}, limit in {payoutCurrencyLabel(candidate)} ·{" "}
                          {candidate.terminal}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <p className="mt-1 text-xs text-zinc-500">
                    Available {formatUnits(option.availableAmount, option.decimals)}{" "}
                    {payoutCurrencyLabel(option)} · Terminal balance{" "}
                    {formatUnits(option.balance, option.decimals)} {option.symbol}
                  </p>
                  {selected.has(row.chainId) ? (
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-zinc-600">
                        Payout amount ({payoutCurrencyLabel(option)})
                        <Input
                          aria-label={`Payout amount on ${chainName(row.chainId)}`}
                          inputMode="decimal"
                          disabled={busy || Boolean(pending)}
                          value={amountFor(option)}
                          onChange={(event) =>
                            setAmounts((current) => ({
                              ...current,
                              [option.key]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="text-xs text-zinc-600">
                        Minimum terminal tokens ({option.symbol}, before fees)
                        <Input
                          aria-label={`Minimum payout on ${chainName(row.chainId)}`}
                          inputMode="decimal"
                          disabled={busy || Boolean(pending)}
                          value={minimumFor(option)}
                          onChange={(event) =>
                            setMinimums((current) => ({
                              ...current,
                              [option.key]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })
      )}
      <div className="mt-4 flex justify-end">
        <ButtonWithWallet
          disabled={busy || Boolean(pending) || !selected.size}
          loading={busy}
          onClick={() => void buildReview()}
        >
          Review selected payouts
        </ButtonWithWallet>
      </div>
      {status && !review ? (
        <p role="status" className="mt-2 text-sm text-zinc-600">
          {status}
        </p>
      ) : null}
      {error && !review ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {review ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setReview(null);
          }}
          title="Review project payouts"
          action="Send payouts"
          chainId={review.destinations[0]!.option.chainId}
          steps={review.destinations.map(({ option }) => ({
            key: option.key,
            title: `Send payouts on ${chainName(option.chainId)}`,
          }))}
          activeIndex={busy ? 0 : -1}
          onConfirm={() => void submit()}
          busy={busy}
          status={status}
          error={error}
        >
          {review.destinations.map(({ option, call }) => (
            <SummaryRow
              key={option.key}
              label={`${chainName(option.chainId)} · Project #${option.projectId}`}
            >
              <span>
                {formatUnits(call.args[2], option.decimals)} {payoutCurrencyLabel(option)}
              </span>
              <span className="block text-xs text-zinc-500">
                Minimum {formatUnits(call.args[4], option.decimals)} {option.symbol} before fees ·
                Ruleset {option.rulesetId}, cycle {option.cycleNumber}
              </span>
              <span className="block break-all text-xs text-zinc-500">
                Terminal {option.terminal} · Token {option.token}
              </span>
              {payoutRecipients(option, review.account).map((recipient, index) => (
                <span key={index} className="block break-all text-xs">
                  {recipient}
                </span>
              ))}
            </SummaryRow>
          ))}
        </TxConfirmDialog>
      ) : null}
    </section>
  );
}
