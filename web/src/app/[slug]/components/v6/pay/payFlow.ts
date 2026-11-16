import type { Hex } from "viem";
import type { PreparedV6Pay, V6PayPhase } from "./V6PayConfirmDialog";

/** How a failed payment is offered again: with a looser tolerance, or quoted afresh. */
type PayRecovery = { kind: "slippage"; bps: number } | { kind: "reverted" };

type Sending = "authorizing" | "approving-token" | "simulating" | "signing";

/**
 * The pay card's confirm, one state at a time. `open` is the confirm dialog's; a Safe proposal
 * keeps being followed while it is closed.
 */
export type PayFlow = { open: boolean } & (
  | { phase: "preparing"; notice: string | null }
  | {
      phase: "ready";
      prepared: PreparedV6Pay | null;
      error: string | null;
      recovery: PayRecovery | null;
    }
  | { phase: Sending; prepared: PreparedV6Pay }
  | { phase: "pending"; prepared: PreparedV6Pay; hash: Hex }
  | { phase: "safe-proposed"; prepared: PreparedV6Pay; hash: Hex; approval: boolean }
  | { phase: "success"; prepared: PreparedV6Pay | null; hash: Hex | null }
);

export type PayFlowAction =
  /** Open the confirm on a fresh preparation. */
  | { type: "open" }
  /** Show or close the confirm; closing abandons a recovery. */
  | { type: "show"; open: boolean }
  /** Prepare again, saying why when the payer should know. */
  | { type: "prepare"; notice?: string }
  | { type: "prepared"; prepared: PreparedV6Pay }
  | { type: "send"; phase: Sending }
  /** The approval's receipt succeeded: the payment step is next. */
  | { type: "approved" }
  | { type: "submitted"; hash: Hex }
  /** The review was closed without a send. */
  | { type: "closed" }
  | { type: "proposed"; hash: Hex; approval: boolean }
  | { type: "done" }
  | { type: "failed"; error: string | null; recovery?: PayRecovery | null }
  | { type: "slippage"; bps: number }
  | { type: "reset" };

export const PAY_FLOW_START: PayFlow = { open: false, phase: "preparing", notice: null };

const preparedOf = (flow: PayFlow) => ("prepared" in flow ? flow.prepared : null);
const hashOf = (flow: PayFlow) => ("hash" in flow ? flow.hash : null);

export function payFlow(flow: PayFlow, action: PayFlowAction): PayFlow {
  const { open } = flow;
  const prepared = preparedOf(flow);
  const ready = (error: string | null, recovery: PayRecovery | null = null): PayFlow => ({
    open,
    phase: "ready",
    prepared,
    error,
    recovery,
  });
  switch (action.type) {
    case "open":
      return { open: true, phase: "preparing", notice: null };
    case "show":
      return flow.phase === "ready" && !action.open
        ? { ...flow, open: false, recovery: null }
        : { ...flow, open: action.open };
    case "prepare":
      return { open, phase: "preparing", notice: action.notice ?? null };
    case "prepared":
      return flow.phase === "preparing"
        ? { open, phase: "ready", prepared: action.prepared, error: flow.notice, recovery: null }
        : flow;
    case "failed":
      return ready(action.error, action.recovery);
    case "closed":
      return { ...ready(null), open: false };
    case "done":
      return { open, phase: "success", prepared, hash: hashOf(flow) };
    case "slippage":
      return flow.phase === "ready" && flow.recovery?.kind === "slippage"
        ? { ...flow, recovery: { kind: "slippage", bps: action.bps } }
        : flow;
    case "reset":
      return PAY_FLOW_START;
  }
  if (!prepared) return flow;
  switch (action.type) {
    case "send":
      return { open, phase: action.phase, prepared };
    case "approved":
      return { ...flow, prepared: { ...prepared, tokenApprovalComplete: true } } as PayFlow;
    case "submitted":
      return { open, phase: "pending", prepared, hash: action.hash };
    case "proposed":
      return {
        open,
        phase: "safe-proposed",
        prepared,
        hash: action.hash,
        approval: action.approval,
      };
  }
}

/** What the confirm dialog reads of the flow. */
export function payFlowView(flow: PayFlow) {
  return {
    phase: flow.phase as V6PayPhase,
    prepared: preparedOf(flow),
    error: flow.phase === "preparing" ? flow.notice : flow.phase === "ready" ? flow.error : null,
    retrySlippageBps:
      flow.phase === "ready" && flow.recovery?.kind === "slippage" ? flow.recovery.bps : null,
    revertedOnchain: flow.phase === "ready" && flow.recovery?.kind === "reverted",
    txHash: hashOf(flow) ?? undefined,
  };
}
