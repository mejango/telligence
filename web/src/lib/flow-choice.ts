"use client";

import {
  checkedItLabel,
  HELD_AWAY_SUCCESS_LINE,
  HELD_SEND_AGAIN_LABEL,
  relayrDiscardLine,
  SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL,
  SAVED_ATTEMPT_UNREADABLE_LINE,
  WRITE_EXIT_LABEL,
  writeExitMessage,
} from "@bananapus/nana-sdk-core/review";

/** A choice a flow asks for mid-action: a short title, its lines, and the one way on. */
export type FlowChoice = {
  title: string;
  lines: string[];
  confirmLabel: string;
};

/** `signal` closes the choice unanswered, as when the chain answers it first. */
type FlowChoiceHandler = (choice: FlowChoice, signal?: AbortSignal) => Promise<boolean>;

let handler: FlowChoiceHandler | null = null;

/** The app's dialog provider answers flow choices. Returns the unregister. */
export function registerFlowChoiceHandler(next: FlowChoiceHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** True only when the user took the way on; false without a dialog provider. */
async function chooseInFlow(choice: FlowChoice, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  if (!handler) return false;
  return signal ? handler(choice, signal) : handler(choice);
}

/**
 * An earlier write of this exact call has no confirmed result: the hold's own
 * line, then what sending again does. True only when the user checked their
 * wallet and chose to send again.
 */
export function confirmHeldWriteExit(
  held: {
    line: string;
    warning?: string;
    notice?: string;
    record: { call: { value?: bigint | string } };
  },
  signal?: AbortSignal,
): Promise<boolean> {
  return chooseInFlow(
    {
      title: "Check your wallet",
      lines: [
        held.line,
        writeExitMessage(held.record.call),
        ...(held.warning ? [held.warning] : []),
        ...(held.notice ? [held.notice] : []),
      ],
      confirmLabel: WRITE_EXIT_LABEL,
    },
    signal,
  );
}

/**
 * This action's last write succeeded while the user was away. True only when the user chose to
 * send it again anyway.
 */
export function confirmSendAgain(): Promise<boolean> {
  return chooseInFlow({
    title: "Already done",
    lines: [HELD_AWAY_SUCCESS_LINE],
    confirmLabel: HELD_SEND_AGAIN_LABEL,
  });
}

/**
 * A saved attempt the SDK can't show the result of: its line and warning, and the one "I checked
 * it" action. True only when the user took it.
 */
export function confirmCheckedIt(
  check: { line: string; warning: string },
  next?: string,
): Promise<boolean> {
  return chooseInFlow({
    title: "Check your wallet",
    lines: [check.line, check.warning],
    confirmLabel: checkedItLabel(next),
  });
}

/**
 * Offered only after a check was refused because this browser can't read its saved transactions:
 * the warned way on, for this tab. True only when the user took it.
 */
export function confirmUnreadableExit(): Promise<boolean> {
  return chooseInFlow({
    title: "Check your wallet",
    lines: [SAVED_ATTEMPT_UNREADABLE_LINE],
    confirmLabel: SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL,
  });
}

/**
 * An earlier signature of this action may already have run. True only when
 * the user chose to discard it after checking the revnet.
 */
export function confirmRelayrDiscard(): Promise<boolean> {
  return chooseInFlow({
    title: "Check the revnet",
    lines: [relayrDiscardLine("ran", { subject: "revnet" })],
    confirmLabel: "Discard",
  });
}
