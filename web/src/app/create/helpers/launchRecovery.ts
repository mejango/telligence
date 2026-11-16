import { savedAttempts } from "@/lib/write-hold";
import type {
  SavedAttemptCheck,
  SavedAttemptOutcome,
  SavedAttemptRecovery,
  WriteHeldState,
  WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";
import type { Hex, PublicClient } from "viem";
import {
  discardLaunch,
  journalLaunchSuccess,
  keepSaltForRetry,
  launchAttemptOf,
  savedLaunchAt,
  type LaunchAttempt,
} from "./launchIntent";

/** What the create page shows for a journaled launch; undefined when a new one may be prepared. */
export type LaunchShown =
  /** The chain shows it launched this revnet: nothing is sent again. */
  | { kind: "launched"; chainId: number; revnetId: bigint }
  /** It went through, but its revnet can't be read yet: only looked at again, never resent. */
  | { kind: "confirming"; attempt: LaunchAttempt }
  /** The hold still holds it: its own line, and its exit when due. */
  | { kind: "held"; attempt: LaunchAttempt; state: WriteHeldState }
  /** What became of it can't be shown here: the user checks it. */
  | { kind: "check"; attempt: LaunchAttempt; outcome: SavedAttemptCheck };

/**
 * What the SDK's recovery of a journaled launch means for the page: a success is journaled first
 * and only followed; one shown as this launch, or the hold's final revert, retires it as followed;
 * anything the SDK can't show is a check. The journal goes only once the SDK lets it.
 */
export async function followLaunch(
  attempt: LaunchAttempt,
  outcome: SavedAttemptOutcome<bigint>,
  retire: (reason: Parameters<SavedAttemptRecovery["retire"]>[1]) => Promise<unknown>,
): Promise<LaunchShown | undefined> {
  if (outcome.status === "none") {
    // The user's check or exit retired it: its retry keeps the salt.
    if (outcome.retired === "check" || outcome.retired === "exit") keepSaltForRetry(attempt);
    discardLaunch(attempt);
    return undefined;
  }
  if (outcome.status === "held") return { kind: "held", attempt, state: outcome.state };
  // A success the journal recorded is only followed: never a check, a discard or a send.
  if (outcome.status === "check" && attempt.saved?.hash) return { kind: "confirming", attempt };
  if (outcome.status === "check") return { kind: "check", attempt, outcome };
  if (outcome.result === "failed") {
    await retire({ by: "settled", hash: outcome.hash });
    discardLaunch(attempt, outcome.hash);
    return undefined;
  }
  if (outcome.hash) journalLaunchSuccess(attempt, outcome.hash);
  if (!outcome.authenticated) return { kind: "confirming", attempt };
  await retire({ by: "settled", hash: outcome.hash });
  discardLaunch(attempt, outcome.hash);
  return { kind: "launched", chainId: attempt.chainId, revnetId: outcome.value };
}

/** Whether a launch is journaled at `key`; one that won't read counts. */
export function launchJournaled(key: string): boolean {
  try {
    return savedLaunchAt(key) !== undefined;
  } catch {
    return true;
  }
}

/**
 * The SDK's recovery of the launch journaled at `key`, outside any view: the page's own follow of
 * a launch it just sent, and the tests. No journal: nothing was handed to the wallet from here.
 */
export async function recoverLaunchAt(
  key: string,
  account: Hex,
  client: PublicClient,
  namespaces?: readonly string[],
  forceUnreadable?: () => boolean,
): Promise<LaunchShown | undefined> {
  if (!launchJournaled(key)) return undefined;
  const attempt = launchAttemptOf(key, account, client, namespaces, forceUnreadable);
  const outcome = await savedAttempts.recover(attempt, client as unknown as WriteHoldClient);
  return followLaunch(attempt, outcome, (reason) => savedAttempts.retire(attempt, reason));
}
