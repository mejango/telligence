"use client";

import { recordSubmittedWrite, settleSubmittedWrite } from "@/lib/held-rows";
import {
  ACCOUNT_CHANGED,
  revertedStep,
  ReviewRefusal,
  type ReviewedRunResult,
} from "@/lib/reviewed-call";
import {
  announcingSign,
  loadEngine,
  reviewedSendDeps,
  reviewedWalletAdapter,
  reviewedWalletOf,
  WALLET_CHANGED,
  type ReviewedWallet,
} from "@/lib/reviewed-send-deps";
import { isSafeConnection, safeWalletPeerSettled } from "@/lib/safe-connector";
import type { SafeQueuedTransaction } from "@/lib/safe-service-config";
import { canonicalSafeTxHash, SAFE_NONCE_GUIDANCE } from "@/lib/safe-service-config";
import { requireNoViewAs } from "@/lib/view-as";
import { answerHeldRefusal, isHeldRefusal, writeHolds } from "@/lib/write-hold";
import type { ReviewedCall, ReviewedPlan } from "@bananapus/nana-sdk-core/review";
import {
  ConfirmationQueuedError,
  discardReviewedSequence,
  findReviewedSequence,
  openStepHold,
  REVIEWED_ENGINE_LOAD_LINE,
  type WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";
import {
  useReviewedRun,
  type UseReviewedRunDeps,
  type UseReviewedRunResult,
} from "@bananapus/nana-sdk-core/review/react";
import type { Permit2SignatureAuthorization } from "@bananapus/nana-sdk-core/v6";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useConfig, type Config } from "wagmi";
import { getAccount, getPublicClient } from "wagmi/actions";

export {
  failedLine,
  isSafeProposalPendingError,
  requireDone,
  requireProposedOrDone,
  reviewClosed,
  reviewedCall,
  ReviewRefusal,
  SAFE_PROPOSAL_PENDING_LINE,
  SAFE_PROPOSAL_UNCONFIRMED_LINE,
  SafeProposalPendingError,
  type ReviewedRunResult,
  type WriteRequest,
} from "@/lib/reviewed-call";
export { announcingSign, reviewedWalletAdapter } from "@/lib/reviewed-send-deps";
export type { ReviewedCall } from "@bananapus/nana-sdk-core/review";

export { WALLET_CHANGED };

export { loadEngine };

export type ReviewedActionInput = Parameters<UseReviewedRunResult["run"]>[0];

/**
 * revnet's one reviewed send, over core's useReviewedRun: revnet's wallet, chains, write hold and
 * view-as guard. Core reviews, simulates, holds, journals and sends. This hook adds revnet's review
 * copy, refuses a changed wallet connection, answers a held refusal with the hold's dialogs, and
 * journals each sent write for the account page.
 */
export function useReviewedAction() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  // The wallets running actions were reviewed on, each refused at the wallet if it changes.
  const reviewed = useRef(new Set<ReviewedWallet>());
  // Core's last synchronous gate selects this operation's assertion; the adapter captures it
  // before acquisition, so overlapping actions cannot replace each other's final assertion.
  const finalCheck = useRef<(() => void) | undefined>(undefined);
  const deps = useMemo<UseReviewedRunDeps>(
    () => ({
      ...reviewedSendDeps(
        config,
        () => reviewed.current,
        () => finalCheck.current,
      ),
      account: address,
      guard: requireNoViewAs,
      engine: loadEngine,
      // A held step whose confirm was closed settled later: what it changed reads again.
      onDismissedSettled: () => void queryClient.invalidateQueries(),
    }),
    [config, address, queryClient],
  );
  const runner = useReviewedRun(deps);
  const latest = useRef(runner);
  latest.current = runner;

  /** A confirmed step whose notice waits behind this run's own locks (core's queued line). */
  const [queuedLine, setQueuedLine] = useState<string | null>(null);

  const runOnce = useCallback(
    async (action: ReviewedActionInput): Promise<ReviewedRunResult> => {
      setQueuedLine(null);
      // Its own preparation, before any review or wallet: a failure here is every flow's
      // "nothing was sent", not a throw each caller must catch.
      let requirePriceBasedShopVoting: typeof import("@/lib/shop-voting-policy").requirePriceBasedShopVoting;
      try {
        await safeWalletPeerSettled();
        ({ requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy"));
      } catch (cause) {
        return {
          status: "failed",
          error: REVIEWED_ENGINE_LOAD_LINE,
          failure: Object.assign(new ReviewRefusal(REVIEWED_ENGINE_LOAD_LINE), { cause }),
        };
      }
      const safe = isSafeConnection(config);
      // Its sends are journaled under the account it was reviewed for, whatever the wallet shows.
      const account = action.account ?? getAccount(config).address;
      const rows: string[] = [];
      const [first] = action.calls;
      const wallet = account ? reviewedWalletOf(config, account) : undefined;
      if (wallet) reviewed.current.add(wallet);
      const result = await latest.current
        .run({
          ...action,
          title:
            action.title ??
            (action.calls.length === 1 && first?.functionName
              ? `Review ${first.functionName}`
              : undefined),
          confirmLabel: safe
            ? "Agree & propose to Safe"
            : (action.confirmLabel ?? "Agree & continue"),
          description:
            [action.description, safe ? SAFE_NONCE_GUIDANCE : undefined, writeHolds.reviewLine()]
              .filter(Boolean)
              .join("\n\n") || undefined,
          assertWriteState: () => {
            requireNoViewAs();
            if (isSafeConnection(config) !== safe) throw new ReviewRefusal(WALLET_CHANGED);
            for (const call of action.calls) requirePriceBasedShopVoting(call.data, call.to);
            action.assertWriteState?.();
            finalCheck.current = action.assertWriteState;
          },
          onSubmitted: async (call, step, hash, sent) => {
            // A Safe batch is one proposal: one row, for every call, under its first call's hold.
            const batch = action.batch && sent.safe && action.calls.length > 1;
            if (account && !sent.adopted && !(batch && step > 0))
              rows[step] = recordSubmittedWrite(
                call,
                hash,
                account,
                action.title ?? call.label ?? "Transaction",
                sent.safe,
                batch ? action.calls : undefined,
              );
            await action.onSubmitted?.(call, step, hash, sent);
          },
        })
        .finally(() => {
          if (wallet) reviewed.current.delete(wallet);
        });
      // Sent, its receipt still verifying: pending (the hook's `receipt` phase), never failed or a
      // reason to resend, until its hold ends the run, or `dismiss` ends the wait (null) and the
      // hold keeps following it.
      const ended = result?.status === "receipt" ? await result.ended() : result;
      // Confirmed, its notice queued behind this run's own locks: its line shows until the next
      // run or a reset, nothing is sent again, and a retry closes on that success.
      if (ended?.status === "failed" && ended.failure instanceof ConfirmationQueuedError)
        setQueuedLine(ended.error);
      if (ended?.status === "done")
        for (const id of rows) if (id) settleSubmittedWrite(id, "success");
      if (ended?.status === "failed") {
        const step = revertedStep(ended.failure);
        const id = step === undefined ? undefined : rows[step];
        if (id) settleSubmittedWrite(id, "failed");
      }
      return ended;
    },
    [config],
  );

  const run = useCallback(
    async (action: ReviewedActionInput): Promise<ReviewedRunResult> => {
      const account = action.account ?? getAccount(config).address;
      const saved =
        action.scope !== undefined && account ? findReviewedSequence(action.scope, account) : null;
      // A rebuilt plan (fresh deadlines, an approval already spent) replaces an unfinished earlier
      // run of the action; a step of it still held refuses this with its own line.
      if (saved && !sameCalls(saved.calls, action.calls))
        try {
          await discardReviewedSequence(saved);
        } catch (cause) {
          const line = cause instanceof Error ? cause.message : "This action is still pending.";
          return { status: "failed", error: line, failure: new ReviewRefusal(line) };
        }
      for (;;) {
        const result = await runOnce(action);
        if (result?.status !== "failed" || !isHeldRefusal(result.failure)) return result;
        // The hold refused a step: its exit, or sending a success from while away again, is
        // offered as before, and the action is reviewed again once the user's answer allows it.
        const account = getAccount(config).address;
        const safe = isSafeConnection(config);
        const held = account
          ? action.calls
              .map((call) => ({ call, handle: openStepHold(writeHolds, account, safe, call) }))
              .find(
                ({ handle }) => handle.peek().status !== "clear" || handle.unacknowledgedSuccess(),
              )
          : undefined;
        if (!held) return result;
        const client = getPublicClient(config, { chainId: held.call.chainId } as never);
        try {
          await answerHeldRefusal(
            result.failure,
            held.handle,
            client as unknown as WriteHoldClient,
          );
        } catch (cause) {
          return {
            status: "failed",
            error: cause instanceof Error ? cause.message : result.error,
            failure: new ReviewRefusal(cause instanceof Error ? cause.message : result.error),
          };
        }
      }
    },
    [config, runOnce],
  );

  const failure = runner.failure;
  return {
    ...runner,
    run,
    /** The wallet, chains and hold the run sends through, for core's Safe service sends. */
    deps,
    /** The line to show: a queued confirmation's, a site's own refusal as it is, else core's. */
    error: queuedLine ?? (failure instanceof ReviewRefusal ? failure.message : runner.error),
    /** Closes the confirm (core's `dismiss`); a queued confirmation's line goes with it. */
    dismiss: () => {
      const closed = runner.dismiss();
      if (closed) setQueuedLine(null);
      return closed;
    },
    reset: () => {
      setQueuedLine(null);
      runner.reset();
    },
    /**
     * A step before the last that settled after its run ended (a Safe's approval): the run is idle
     * and running the action again continues from the next step.
     */
    settledStep: runner.settled && !runner.settled.finished ? runner.settled.step : null,
  };
}

export type ReviewedAction = ReturnType<typeof useReviewedAction>;

/**
 * Signs one Safe transaction after core's review of it (its calls decoded), or under `plan`, one
 * the person already reviewed. `reverify` rechecks the Safe and signer before the wallet opens
 * and again once it closes, before the signature can be used.
 */
export function useSafeTransactionSignature() {
  const config = useConfig();
  const signSafeTransactionAsync = useCallback(
    async ({
      chainId,
      safe,
      tx,
      reverify,
      plan,
      onSign,
    }: {
      chainId: number;
      safe: Address;
      tx: SafeQueuedTransaction;
      reverify?: (account: Address) => Promise<void>;
      plan?: ReviewedPlan;
      /** Runs as the wallet opens, once the review is agreed to. */
      onSign?: () => void;
    }): Promise<Hex> => {
      const { address: account, connector } = getAccount(config);
      if (!account) throw new Error("Connect a wallet first.");
      // The service's advertised hash must be the call rebuilt from its fields.
      canonicalSafeTxHash(chainId, safe, tx);
      const { requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy");
      const { signReviewed } = await loadEngine();
      const adapter = reviewedWalletAdapter(config, account, connector);
      const [signature] = await signReviewed(
        [{ kind: "safe-tx", chainId, safe, tx }],
        {
          account,
          title: "Review Safe transaction signature",
          description:
            "This signature approves the exact queued Safe call. It does not execute until the threshold and nonce requirements are met.",
          reverify: async () => {
            requirePriceBasedShopVoting(tx.data ?? "0x", tx.to, Number(tx.operation));
            await reverify?.(account);
          },
          plan,
        },
        { adapter: announcingSign(adapter, onSign) },
      );
      // A wallet prompt has no time bound: the wallet, the Safe and the signer are checked again
      // before the signature goes anywhere.
      adapter.requireUnchanged();
      await reverify?.(account);
      adapter.requireUnchanged();
      return signature!;
    },
    [config],
  );
  return { signSafeTransactionAsync };
}

/**
 * The payer signs the exact, expiring Permit2 allowance for one payment, after core's review of
 * it. Nothing moves until the payment that carries the signature is sent.
 */
export async function signPayAuthorization(
  config: Config,
  authorization: Permit2SignatureAuthorization,
  expected: Address,
): Promise<Hex> {
  requireNoViewAs();
  const { address: account, connector } = getAccount(config);
  if (!account || account.toLowerCase() !== expected.toLowerCase())
    throw new Error(ACCOUNT_CHANGED);
  const { signReviewed } = await loadEngine();
  const adapter = reviewedWalletAdapter(config, account, connector);
  const [signature] = await signReviewed(
    [{ kind: "permit2", authorization }],
    {
      account,
      title: "Authorize the payment",
      description:
        "Your signature lets this payment, and only this payment, take the exact amount. It costs no gas and expires in 30 minutes.",
    },
    { adapter },
  );
  // A wallet prompt has no time bound: the wallet is checked again before the signature is used.
  adapter.requireUnchanged();
  return signature!;
}

/** The calls as core compares an unfinished run with a new one (useReviewedRun's `sent`). */
function sameCalls(a: readonly ReviewedCall[], b: readonly ReviewedCall[]): boolean {
  const key = (calls: readonly ReviewedCall[]) =>
    calls
      .map(
        (call) =>
          `${call.chainId}:${call.to.toLowerCase()}:${call.data.toLowerCase()}:${call.value ?? 0n}:${call.gas ?? ""}`,
      )
      .join("|");
  return key(a) === key(b);
}
