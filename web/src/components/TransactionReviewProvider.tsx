"use client";

import { FlowChoiceDialog } from "@/components/FlowChoiceDialog";
import { LoadingText } from "@/components/ui/LoadingText";

import {
  ReviewScopeContext,
  type TransactionReviewScope,
} from "@/components/TransactionReviewScope";
import { ModalDialog } from "@/components/ui/ModalShell";
import { registerFlowChoiceHandler, type FlowChoice } from "@/lib/flow-choice";
import { registerSafeNonceHandler, type SafeNonceRequest } from "@/lib/safe-nonce-choice";
import {
  registerFundingChainSelectionHandler,
  type FundingChainOption,
} from "@/lib/transaction-review";
import { registerReviewHandler, type ReviewModel } from "@bananapus/nana-sdk-core/review";
import { createReviewQueue } from "@bananapus/nana-sdk-core/review/machines";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type PropsWithChildren,
} from "react";

export type PendingReview = {
  kind: "review";
  id: number;
  /** Core's prompt: the model it bound, confirmed only by the confirmation it minted. */
  model: ReviewModel;
};

export type PendingFundingChainSelection = {
  kind: "funding";
  id: number;
  options: readonly FundingChainOption[];
  initialChainId: number | null;
};

export type PendingSafeNonceSelection = { kind: "nonce"; id: number; request: SafeNonceRequest };

/** A choice a flow asks for mid-action, such as sending a held write again. */
type PendingFlowChoice = { kind: "choice"; id: number; choice: FlowChoice };

type PendingDialog =
  PendingReview | PendingFundingChainSelection | PendingSafeNonceSelection | PendingFlowChoice;

/** The dialogs the lazily loaded review module draws. */
type PendingReviewDialog = PendingReview | PendingFundingChainSelection | PendingSafeNonceSelection;

export type TransactionReviewDialogProps = {
  pending: PendingReviewDialog;
  onFinish: (result: boolean | number | null) => void;
  projectCheckPending?: boolean;
};

type Answer = boolean | number | null;
type Payload =
  | Omit<PendingReview, "id">
  | Omit<PendingFundingChainSelection, "id">
  | Omit<PendingSafeNonceSelection, "id">
  | Omit<PendingFlowChoice, "id">;
const approves = (result: Answer) => result === true || typeof result === "number";

/**
 * Global, promise-based modal queue over core's review queue. Every low-level transaction
 * boundary registers with this one provider, so simultaneous multichain flows review
 * sequentially and each approval applies to one immutable call snapshot.
 */
export function TransactionReviewProvider({ children }: PropsWithChildren) {
  const [queue] = useState(() => createReviewQueue<Payload, Answer>());
  const state = useSyncExternalStore(queue.subscribe, queue.getState, queue.getState);
  const active = useMemo(
    () =>
      state.active ? ({ ...state.active.payload, id: state.active.id } as PendingDialog) : null,
    [state.active],
  );
  const [Dialog, setDialog] = useState<ComponentType<TransactionReviewDialogProps> | null>(null);

  useEffect(
    () =>
      registerReviewHandler(async (prompt) => {
        const approved = await queue.request(
          { kind: "review", model: prompt.model },
          { declined: false, approves },
        );
        return approved === true ? prompt.confirmation : null;
      }),
    [queue],
  );
  useEffect(
    () =>
      registerFlowChoiceHandler(
        async (choice: FlowChoice, signal?: AbortSignal) =>
          (await queue.request(
            { kind: "choice", choice: { ...choice, lines: [...choice.lines] } },
            { declined: false, approves, signal },
          )) === true,
      ),
    [queue],
  );
  useEffect(
    () =>
      registerFundingChainSelectionHandler(async (options, initialChainId) => {
        const chosen = await queue.request(
          {
            kind: "funding",
            options: options.map((option) => ({ ...option })),
            initialChainId,
          },
          { declined: null, approves },
        );
        return typeof chosen === "number" ? chosen : null;
      }),
    [queue],
  );
  useEffect(
    () =>
      registerSafeNonceHandler(async (request) => {
        const chosen = await queue.request(
          { kind: "nonce", request: { ...request, choices: [...request.choices] } },
          { declined: null, approves },
        );
        return typeof chosen === "number" ? chosen : null;
      }),
    [queue],
  );
  useEffect(() => () => queue.cancelAll(), [queue]);

  // Each registration is its own scope, even for the same project: one that ends takes its
  // dialogs with it.
  const registrations = useRef(0);
  const registered = useRef<string | null>(null);
  const registerScope = useCallback(
    (scope: TransactionReviewScope) => {
      const identity = `${scope.identity}#${++registrations.current}`;
      registered.current = identity;
      queue.setContext({ scope: { identity, verify: scope.verify } });
      return () => {
        if (registered.current !== identity) return;
        registered.current = null;
        queue.setContext({ scope: null });
      };
    },
    [queue],
  );
  const finish = useCallback(
    (id: number, result: Answer) => void queue.finish(id, result),
    [queue],
  );

  // The review UI loads once the page is idle, so the first click opens it with no wait.
  useEffect(() => {
    const load = () => void import("./TransactionReviewDialog").catch(() => undefined);
    if (typeof requestIdleCallback !== "function") return void setTimeout(load, 1_000);
    const id = requestIdleCallback(load, { timeout: 3_000 });
    return () => cancelIdleCallback(id);
  }, []);

  // Keep the global queue ready immediately, but fetch the full decoder and
  // review UI when a request arrives if the idle load hasn't. Loading never authorizes a call;
  // cancellation, unmount, or a failed download resolves it as declined.
  useEffect(() => {
    if (!active || active.kind === "choice" || Dialog) return;
    let cancelled = false;
    void import("./TransactionReviewDialog").then(
      (module) => {
        if (!cancelled) setDialog(() => module.TransactionReviewDialog);
      },
      () => {
        if (!cancelled) queue.cancel(active.id);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, Dialog, queue]);

  return (
    <ReviewScopeContext.Provider value={registerScope}>
      {children}
      {active?.kind === "choice" ? (
        <FlowChoiceDialog
          key={active.id}
          id={active.id}
          choice={active.choice}
          onFinish={(confirmed) => finish(active.id, confirmed)}
        />
      ) : active ? (
        Dialog ? (
          <Dialog
            key={active.id}
            pending={active}
            projectCheckPending={state.checking}
            onFinish={(result) => finish(active.id, result)}
          />
        ) : (
          <ModalDialog
            key={active.id}
            onClose={() => finish(active.id, null)}
            labelledBy={`transaction-review-loading-${active.id}`}
            className="items-start justify-center px-3 py-5 sm:px-6 sm:py-10"
          >
            <div className="w-full max-w-lg border border-melon-700 bg-melon-25 p-5 shadow-2xl">
              <p id={`transaction-review-loading-${active.id}`} role="status">
                <LoadingText text="Loading transaction review…" />
              </p>
              <button
                type="button"
                onClick={() => finish(active.id, null)}
                className="mt-4 min-h-[44px] border border-melon-600 px-5 text-sm"
              >
                Cancel
              </button>
            </div>
          </ModalDialog>
        )
      ) : null}
    </ReviewScopeContext.Provider>
  );
}
