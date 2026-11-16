import { keepOutcome, type ReviewedCall } from "@bananapus/nana-sdk-core/review";
import { assertLocksHeld, type LockHandle } from "@bananapus/nana-sdk-core/review/locks";
import { reviewedRunStatus } from "@bananapus/nana-sdk-core/review/machines";
import { useEffect, useReducer } from "react";
import type { Hex } from "viem";
import { vi, type Mock } from "vitest";

/** As core: a site's outcome callback refused for a lost lock is kept for when its locks are back. */
export const coreKept = (locks: readonly LockHandle[] | undefined, write: () => unknown) =>
  keepOutcome(locks, write);
/** As core: nothing was sent, told only under the site's locks, kept for a lost one. */
export const coreUnsent = (locks: readonly LockHandle[] | undefined, tell?: () => unknown) =>
  coreKept(locks, async () => {
    await assertLocksHeld(locks ?? []);
    await tell?.();
  }).catch((lost: { code?: string }) => {
    if (lost?.code !== "LOCK_LOST") throw lost;
  });

/**
 * A stand-in for useReviewedAction's `run` that a site's test drives: it simulates then sends each
 * call through `simulate` and `write`, as core does after the review, and ends done. Each sees the
 * exact reviewed call and its action.
 */
export function reviewedRunMock(simulate: Mock, write: Mock) {
  return vi.fn(async (action: { calls: readonly ReviewedCall[]; account?: unknown }) => {
    const hashes: Hex[] = [];
    for (const call of action.calls) {
      await simulate(call, action);
      hashes.push((await write(call, action)) as Hex);
    }
    return {
      status: "done" as const,
      hashes,
      receipts: hashes.map((transactionHash) => ({ status: "success", transactionHash })),
    };
  });
}

/** useReviewedAction's state around a mocked `run`, idle. */
export function reviewedActionState(run: Mock) {
  return {
    run,
    phase: "idle" as const,
    step: 0,
    total: 0,
    error: null,
    failure: null,
    hash: null,
    safeTxHash: null,
    receipt: null,
    held: null,
    status: "idle" as const,
    busy: false,
    exitAction: null,
    sendAgainAction: null,
    following: false,
    reset: () => undefined,
    dismiss: () => true,
  };
}

type RunState = { phase: string; held: { exit?: unknown } | null };

/**
 * A stand-in for useReviewedAction that goes through a site's own hooks as core does after the
 * review: per call its reverify, beforeWallet and write gate, then `write` as the wallet (given the
 * call with `address` and `account`, as the old engine's writes were), then onSubmitted. A hash
 * `proposed` names went to a Safe as a proposal whose result can't be confirmed; a 4001 is unsent.
 * Returns the hook's mock and its state, which the run updates as core's would.
 */
export function reviewedActionThrough(
  write: Mock,
  options: {
    proposed?: (hash: Hex) => boolean;
    /** The connected account, which core's wallet step requires to still be the run's. */
    connected?: () => string;
    /** A Safe app: a `batch` run of several calls is one proposal, written once as `{ batch }`. */
    safeBatch?: boolean;
  } = {},
) {
  const state: RunState = { phase: "idle", held: null };
  // While held, the review stays open: the user is still reading it.
  let review: Promise<void> | null = null;
  const holdReview = () => {
    let release!: () => void;
    review = new Promise((resolve) => (release = resolve));
    return () => {
      review = null;
      release();
    };
  };
  const run = vi.fn(async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
    const hashes: Hex[] = [];
    await review;
    if (options.safeBatch && action.batch && action.calls.length > 1) {
      for (const [step, call] of action.calls.entries()) {
        action.guard?.();
        await action.reverify?.(call, step, undefined);
      }
      await action.beforeWallet?.(action.calls[0]!, 0);
      action.assertWriteState?.();
      let hash: Hex;
      try {
        hash = (await write({ batch: action.calls, account: action.account }, action)) as Hex;
      } catch (failure) {
        state.phase = "idle";
        return { status: "failed" as const, error: (failure as Error).message, failure };
      }
      // Core reports the one proposal once per step.
      for (const [step, call] of action.calls.entries())
        await coreKept(action.locks, () =>
          action.onSubmitted?.(call, step, hash, { safe: true, adopted: false }),
        );
      state.phase = "proposed";
      state.held = { exit: { label: "Check it in Safe" } };
      return { status: "proposed" as const, step: 0, safeTxHash: hash };
    }
    for (const [step, call] of action.calls.entries()) {
      // Core refuses a run whose reviewed account is no longer the connected one.
      const connected = options.connected?.();
      if (connected && action.account && connected.toLowerCase() !== action.account.toLowerCase()) {
        const failure = new Error("The connected account changed. Review again.");
        state.phase = "idle";
        return { status: "failed" as const, error: failure.message, failure };
      }
      action.guard?.();
      await action.reverify?.(call, step, undefined);
      await action.beforeWallet?.(call, step);
      action.assertWriteState?.();
      let hash: Hex;
      try {
        hash = (await write({ ...call, address: call.to, account: action.account }, action)) as Hex;
      } catch (failure) {
        if ((failure as { code?: number }).code === 4001)
          await coreUnsent(action.locks, () => action.onUnsent?.(call, step));
        state.phase = "idle";
        return { status: "failed" as const, error: (failure as Error).message, failure };
      }
      const proposed = !!options.proposed?.(hash);
      await coreKept(action.locks, () =>
        action.onSubmitted?.(call, step, hash, { safe: proposed, adopted: false }),
      );
      if (proposed) {
        state.phase = "proposed";
        state.held = { exit: { label: "Check it in Safe" } };
        return { status: "proposed" as const, step, safeTxHash: hash };
      }
      hashes.push(hash);
    }
    state.phase = "done";
    return {
      status: "done" as const,
      hashes,
      receipts: hashes.map((transactionHash) => ({
        status: "success",
        transactionHash,
        blockNumber: 1n,
        logs: [],
      })),
    };
  });
  const hook = () => ({ ...reviewedActionState(run), ...state, run });
  return { run, hook, state, holdReview };
}

/** How a run that `write` sent ends: still awaiting its receipt, proposed, held, failed, or done. */
export type RunEnd =
  | { phase: "receipt" }
  | { phase: "proposed"; held?: { line: string | null; exit: boolean } }
  | { phase: "held"; error: string; held: { line: string | null; exit: boolean } }
  | { phase: "failed"; error: string; failure?: unknown }
  | undefined;

/**
 * useReviewedAction for a component test that renders its phases: `run` goes through a site's own
 * hooks as reviewedActionThrough's does, then ends as `end` says for the sent hash, and every
 * mounted hook re-renders with the new phase, hold and error.
 */
export function liveReviewedAction(
  write: Mock,
  end: (hash: Hex) => RunEnd = () => undefined,
  /** Core's simulation of each step, given the call as the wallet gets it, before the write gate. */
  simulate?: Mock,
  /** A Safe app: a `batch` run of several calls is one proposal, written once as `{ batch }`. */
  safeBatch?: () => boolean,
) {
  const listeners = new Set<() => void>();
  const blank = { phase: "idle", held: null, error: null } as {
    phase: string;
    held: { line: string | null; exit: boolean; phase: string } | null;
    error: string | null;
  };
  const state = { ...blank };
  const set = (patch: Partial<typeof state>) => {
    Object.assign(state, patch);
    listeners.forEach((listener) => listener());
  };
  // While held, the review stays open: the user is still reading it.
  let review: Promise<void> | null = null;
  const holdReview = () => {
    let release!: () => void;
    review = new Promise((resolve) => (release = resolve));
    return () => {
      review = null;
      release();
    };
  };
  const run = vi.fn(async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
    const hashes: Hex[] = [];
    set({ ...blank, phase: "review" });
    await review;
    if (safeBatch?.() && action.batch && action.calls.length > 1) {
      for (const [step, call] of action.calls.entries()) await action.beforeWallet?.(call, step);
      action.assertWriteState?.();
      const hash = (await write({ batch: action.calls, account: action.account }, action)) as Hex;
      for (const [step, call] of action.calls.entries())
        await coreKept(action.locks, () =>
          action.onSubmitted?.(call, step, hash, { safe: true, adopted: false }),
        );
      set({ phase: "proposed" });
      return { status: "proposed" as const, step: 0, safeTxHash: hash };
    }
    for (const [step, call] of action.calls.entries()) {
      try {
        const sent = { ...call, address: call.to, account: action.account };
        action.guard?.();
        await action.reverify?.(call, step, undefined);
        set({ phase: "simulating" });
        await simulate?.(sent);
        await action.beforeWallet?.(call, step);
        action.assertWriteState?.();
        set({ phase: "signing" });
        hashes.push((await write(sent, action)) as Hex);
      } catch (failure) {
        if ((failure as { code?: number }).code === 4001)
          await coreUnsent(action.locks, () => action.onUnsent?.(call, step));
        const error = (failure as Error).message;
        set({ phase: "idle", error });
        return { status: "failed" as const, error, failure };
      }
      const hash = hashes.at(-1)!;
      await coreKept(action.locks, () =>
        action.onSubmitted?.(call, step, hash, { safe: false, adopted: false }),
      );
      const ended = end(hash);
      if (ended?.phase === "receipt") {
        set({ phase: "receipt" });
        return new Promise<never>(() => undefined);
      }
      if (ended?.phase === "proposed") {
        set({ phase: "proposed", held: ended.held ? { phase: "held", ...ended.held } : null });
        return { status: "proposed" as const, step, safeTxHash: hash };
      }
      if (ended?.phase === "held" || ended?.phase === "failed") {
        const held = ended.phase === "held" ? { phase: "held", ...ended.held } : null;
        const failure =
          ended.phase === "failed" && ended.failure ? ended.failure : new Error(ended.error);
        set({ phase: "idle", error: ended.error, held });
        return { status: "failed" as const, error: ended.error, failure };
      }
    }
    set({ phase: "done" });
    return {
      status: "done" as const,
      hashes,
      receipts: hashes.map((transactionHash) => ({
        status: "success",
        transactionHash,
        blockNumber: 1n,
        logs: [],
      })),
    };
  });
  function useLiveReviewedAction() {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
      listeners.add(rerender);
      return () => void listeners.delete(rerender);
    }, []);
    return {
      ...reviewedActionState(run),
      ...state,
      // Core's rule, from this run's phase, error and hold.
      ...reviewedRunStatus({
        phase: state.phase as Parameters<typeof reviewedRunStatus>[0]["phase"],
        error: state.error,
        settled: null,
        held: state.held as Parameters<typeof reviewedRunStatus>[0]["held"],
      }),
      // Core follows a sent step left at its receipt or a Safe proposal; dismissing either resets
      // the view, as core's does.
      following: state.phase === "receipt" || state.phase === "proposed",
      reset: () => set({ ...blank }),
      dismiss: () => (set({ ...blank }), true),
      run,
    };
  }
  return {
    run,
    hook: useLiveReviewedAction,
    state,
    set,
    holdReview,
    reset: () => {
      review = null;
      set({ ...blank });
    },
  };
}
