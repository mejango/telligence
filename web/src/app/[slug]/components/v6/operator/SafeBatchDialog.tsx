"use client";

import { CallRow } from "@/components/ExactCallCard";
import { Loader2 } from "@/components/ui/icons";
import { SummaryRow, TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { isSafeProposalPendingError, reviewClosed } from "@/lib/reviewed-call";
import {
  checkBatchOrder,
  describeStep,
  moveStep,
  removeStep,
  shortAddress,
  useSafeBatch,
  writeBatch,
  type BatchStep,
} from "@/lib/safe-batch";
import { safeNonceLabel } from "@/lib/safe-nonce-choice";
import { hasSafeService } from "@/lib/safe-service-config";
import { formatWalletError } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { AbiFunction, Address } from "viem";
import { useAccount } from "wagmi";
import { TextSelect } from "../pay/TextSelect";
import { chainName, type ChainProjectRow } from "./operatorLib";
import { useSafeBatchSubmit, type SafeBatchRoute } from "./useSafeBatchSubmit";

/** One argument: a scalar as a `name: value` row, a tuple or array as its rows indented below. */
function ArgumentRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || typeof value !== "object") {
    return <CallRow label={label}>{String(value)}</CallRow>;
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [`${index + 1}`, item] as const)
    : Object.entries(value);
  if (!entries.length) return <CallRow label={label}>[]</CallRow>;
  return (
    <div>
      <dt className="text-zinc-500">{label}:</dt>
      <dd>
        <dl className="ml-1 space-y-0.5 border-l border-melon-200 pl-2">
          {entries.map(([name, item]) => (
            <ArgumentRow key={name} label={name} value={item} />
          ))}
        </dl>
      </dd>
    </div>
  );
}

/** The step's call decoded through its ABI: destination, signature, and each argument by name. */
function DecodedCall({ step }: { step: BatchStep }) {
  const fn = step.abi.find(
    (item): item is AbiFunction => item.type === "function" && item.name === step.functionName,
  );
  return (
    <dl className="mt-2 space-y-0.5 text-xs">
      <CallRow label="To">
        {step.contractName} | {step.to}
      </CallRow>
      <CallRow label="Call">
        {fn
          ? `${fn.name}(${fn.inputs.map((input) => input.type).join(", ")})`
          : step.data.slice(0, 10)}
      </CallRow>
      {fn?.inputs.map((input, index) => (
        <ArgumentRow
          key={`${input.name ?? index}`}
          label={input.name || `argument ${index + 1}`}
          value={step.args[index]}
        />
      ))}
    </dl>
  );
}

function routeSummary(route: SafeBatchRoute | undefined, count: number, chainId: number): string {
  if (!route) return "Checking who can sign…";
  if (route.kind === "safe-app") return "One MultiSend proposal through the Safe app";
  if (route.kind === "safe-signer") {
    return hasSafeService(chainId)
      ? `One MultiSend proposal to the operator Safe (${route.threshold} of ${route.owners.length} signatures)`
      : `One MultiSend batch each operator Safe owner approves onchain (${route.threshold} of ${route.owners.length})`;
  }
  if (route.kind === "eoa") {
    return `${count} transaction${count === 1 ? "" : "s"} from your wallet, in order`;
  }
  return "Not available";
}

function actionLabel(route: SafeBatchRoute | undefined, count: number, chainId: number): string {
  if (route?.kind === "eoa") return `Send ${count} transaction${count === 1 ? "" : "s"}`;
  if (route?.kind === "safe-signer" && !hasSafeService(chainId)) return "Approve batch onchain";
  return "Propose batch to Safe";
}

/**
 * The batch editor for one chain: who sends it and how, then the queued
 * steps in order with reorder/remove controls and their decoded calls. A
 * dependency problem is shown on the offending step and blocks the send;
 * nothing is ever reordered silently. Sending opens the batch's one review.
 */
export function SafeBatchDialog({
  row,
  authority,
  open,
  onOpenChange,
}: {
  row: ChainProjectRow;
  /** The chain's live operator; undefined keeps the historical direct path. */
  authority: Address | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const steps = useSafeBatch(row.chainId, row.projectId);
  // The batch's row comes from the server sucker-group list: only a chain-verified pair sends.
  const gate = useGroupWriteGate([row]);
  const { address } = useAccount();
  const { routeFor, noncesFor, submit } = useSafeBatchSubmit();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // The batch went to the Safe as a proposal: nothing more to send from here.
  const [proposed, setProposed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Direct writes land one by one; a failure keeps only what has not been sent.
  const sent = useRef(0);

  const routeQuery = useQuery({
    queryKey: ["safe-batch-route", row.chainId, address ?? "", authority ?? ""],
    enabled: open && !!address,
    staleTime: 15_000,
    queryFn: () => routeFor({ chainId: row.chainId, authority }),
  });
  const route = address ? routeQuery.data : undefined;
  // A Safe service proposal takes the next free nonce unless a queued one is picked to replace.
  const proposalSafe =
    route?.kind === "safe-signer" && hasSafeService(row.chainId) ? route.safe : undefined;
  const noncesQuery = useQuery({
    queryKey: ["safe-batch-nonces", row.chainId, proposalSafe ?? ""],
    enabled: open && !!proposalSafe,
    staleTime: 15_000,
    queryFn: () => noncesFor({ chainId: row.chainId, safe: proposalSafe! }),
  });
  const nonces = proposalSafe ? noncesQuery.data : undefined;
  // The row is there from the start, so the choice cannot appear unnoticed after a slow read.
  const noncesLoading =
    !!address && (routeQuery.isLoading || (!!proposalSafe && noncesQuery.isLoading));
  const [pickedNonce, setPickedNonce] = useState<number | null>(null);
  const proposalNonce =
    nonces && pickedNonce !== null && nonces.choices.includes(pickedNonce)
      ? pickedNonce
      : nonces?.next;
  const { problems } = checkBatchOrder(steps);
  const name = chainName(row.chainId);
  const update = (next: BatchStep[]) => writeBatch(row.chainId, row.projectId, next);

  const confirm = async () => {
    if (busy || !route || route.kind === "refused" || !steps.length || problems.length) return;
    if (gate.blocked) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    sent.current = 0;
    setActiveIndex(0);
    const submitted = steps;
    try {
      const outcome = await submit({
        chainId: row.chainId,
        steps: submitted,
        route,
        proposalNonce,
        onProgress: setStatus,
        onStep: (index) => {
          sent.current = index;
          setActiveIndex(index);
        },
      });
      update([]);
      const message =
        outcome.kind === "sent"
          ? `Sent ${outcome.transactions} transaction${outcome.transactions === 1 ? "" : "s"} on ${name}.`
          : outcome.kind === "confirmed"
            ? `Your confirmation was added to the identical batch of ${outcome.calls} calls already queued in the Safe on ${name}.`
            : outcome.kind === "approved"
              ? `Approved onchain on ${name} (${outcome.approvals} of ${outcome.threshold}). Each other owner adds the same steps in the same order and approves; the one who reaches ${outcome.threshold} executes it.`
              : outcome.kind === "executed"
                ? `Executed the batch of ${outcome.calls} call${outcome.calls === 1 ? "" : "s"} on ${name}.`
                : `Proposed to Safe as one batch of ${outcome.calls} call${outcome.calls === 1 ? "" : "s"} on ${name}.`;
      toast({
        title:
          outcome.kind === "sent" || outcome.kind === "executed"
            ? "Batch sent"
            : outcome.kind === "approved"
              ? "Batch approved"
              : "Batch proposed",
        description: message,
      });
      onOpenChange(false);
    } catch (cause) {
      if (sent.current > 0) update(submitted.slice(sent.current));
      const message = formatWalletError(cause) || "Could not submit the batch.";
      if (reviewClosed(cause)) setStatus(null);
      else if (isSafeProposalPendingError(cause)) {
        setStatus(message);
        setProposed(true);
        toast({ title: "Safe proposal submitted", description: message });
      } else {
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      }
    } finally {
      setBusy(false);
      setActiveIndex(-1);
    }
  };

  const onchain = route?.kind === "safe-signer" && !hasSafeService(row.chainId);
  const prompts =
    route?.kind === "eoa"
      ? steps.map((step) => ({ key: step.id, title: step.label, detail: describeStep(step) }))
      : onchain
        ? [
            {
              key: "approve",
              title: "Approve batch onchain",
              detail: `${name} has no Safe transaction service. Each owner approves the same batch onchain; the owner who reaches the threshold executes it.`,
            },
          ]
        : [
            {
              key: "propose",
              title: "Propose batch to Safe",
              detail: `${steps.length} call${steps.length === 1 ? "" : "s"} execute together, in this order, once the Safe's approvals are in.`,
            },
          ];
  const from =
    route && route.kind !== "refused"
      ? route.kind === "safe-signer"
        ? route.safe
        : route.authority
      : (authority ?? address);
  const fromTag =
    route?.kind === "safe-signer" || route?.kind === "safe-app"
      ? "Safe"
      : route?.kind === "eoa"
        ? "Wallet"
        : null;

  return (
    <TxProgress
      open={open}
      onClose={() => onOpenChange(false)}
      title={`Batch on ${name}`}
      steps={prompts}
      activeIndex={busy ? activeIndex : -1}
      stepsIntro={
        route?.kind === "eoa"
          ? `Your wallet will ask for ${steps.length} transaction${steps.length === 1 ? "" : "s"}, in this order.`
          : onchain
            ? "Your wallet will ask for one transaction."
            : "Your wallet will ask for one signature."
      }
      busy={busy}
      complete={proposed}
      footerContent={
        // The batch is edited here; its one confirmation is the review this opens.
        <div className="flex justify-end">
          <button
            type="button"
            className="min-h-[44px] border border-melon-700 bg-melon-500 px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
            disabled={
              busy ||
              !route ||
              route.kind === "refused" ||
              !steps.length ||
              problems.length > 0 ||
              gate.blocked ||
              noncesLoading
            }
            onClick={() => void confirm()}
          >
            {busy || noncesLoading || gate.pending ? (
              <Loader2 aria-hidden className="mr-2 inline h-4 w-4 animate-spin" />
            ) : null}
            {actionLabel(route, steps.length, row.chainId)}
          </button>
        </div>
      }
      status={
        status ??
        (gate.pending
          ? "Confirming this project's chains onchain…"
          : routeQuery.isLoading
            ? "Checking who can sign…"
            : null)
      }
      error={error ?? gate.line ?? (route?.kind === "refused" ? route.message : null)}
    >
      <SummaryRow label="On">{name}</SummaryRow>
      <SummaryRow label="From">
        {from ? (
          <span className="font-mono text-xs">
            {shortAddress(from)}
            {fromTag ? <span className="ml-1 font-sans text-zinc-500">{fromTag}</span> : null}
          </span>
        ) : (
          "Connect a wallet"
        )}
      </SummaryRow>
      <SummaryRow label="Route">{routeSummary(route, steps.length, row.chainId)}</SummaryRow>
      {nonces && proposalNonce !== undefined ? (
        <SummaryRow label="Safe nonce">
          <TextSelect
            ariaLabel="Safe nonce"
            value={String(proposalNonce)}
            onChange={(value) => setPickedNonce(Number(value))}
            disabled={busy || proposed}
            options={nonces.choices.map((nonce) => ({
              value: String(nonce),
              label: safeNonceLabel(nonce, nonces.next),
            }))}
          />
        </SummaryRow>
      ) : noncesLoading ? (
        <SummaryRow label="Safe nonce">
          <span className="text-zinc-500">Loading…</span>
        </SummaryRow>
      ) : null}
      {steps.length ? (
        <ol className="space-y-2" aria-label="Batch steps">
          {steps.map((step, index) => {
            const problem = problems.find((item) => item.index === index);
            return (
              <li key={step.id} className="border border-melon-200 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-zinc-500"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900">
                      <span className="sr-only">
                        Step {index + 1} of {steps.length}:{" "}
                      </span>
                      {step.label}
                    </p>
                    <p className="text-zinc-500">{describeStep(step)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`Move step ${index + 1} up`}
                      className="h-6 w-6 border border-melon-300 bg-white hover:bg-melon-100 disabled:opacity-40"
                      disabled={busy || index === 0}
                      onClick={() => update(moveStep(steps, index, index - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move step ${index + 1} down`}
                      className="h-6 w-6 border border-melon-300 bg-white hover:bg-melon-100 disabled:opacity-40"
                      disabled={busy || index === steps.length - 1}
                      onClick={() => update(moveStep(steps, index, index + 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove step ${index + 1}`}
                      className="h-6 w-6 border border-melon-300 bg-white hover:bg-melon-100 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => update(removeStep(steps, index))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <DecodedCall step={step} />
                {problem ? (
                  <p role="alert" className="mt-2 text-red-600">
                    {problem.message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-zinc-500">Nothing is queued on {name}.</p>
      )}
    </TxProgress>
  );
}
