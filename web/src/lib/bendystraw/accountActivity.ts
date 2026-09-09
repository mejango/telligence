import type { AccountActivityEventItem, AccountActivityEventsQuery } from "./types";

const EMPTY_SUB_EVENTS = {
  payEvent: null,
  cashOutTokensEvent: null,
  addToBalanceEvent: null,
  mintTokensEvent: null,
  manualMintTokensEvent: null,
  autoIssueEvent: null,
  deployErc20Event: null,
  projectCreateEvent: null,
  projectTransferEvent: null,
  operatorPermissionsSetEvent: null,
  rulesetQueuedEvent: null,
  swapEvent: null,
  buybackPoolEvent: null,
  sendReservedTokensToSplitsEvent: null,
  sendReservedTokensToSplitEvent: null,
} as const;

/** The sub-event kinds that carry a beneficiary and get their own query root. */
const BENEFICIARY_ROOTS = [
  ["beneficiaryPayEvents", "payEvent"],
  ["beneficiaryCashOutEvents", "cashOutTokensEvent"],
  ["beneficiaryMintTokensEvents", "mintTokensEvent"],
  ["beneficiaryManualMintTokensEvents", "manualMintTokensEvent"],
  ["beneficiaryAutoIssueEvents", "autoIssueEvent"],
  ["beneficiarySendReservedTokensToSplitEvents", "sendReservedTokensToSplitEvent"],
] as const;

/**
 * Merge the from-branch activity rows with the beneficiary-branch sub-event
 * rows into one feed, newest first. Rows present in both branches (the
 * account both sent and received) are deduped by sub-event id.
 */
export function mergeAccountActivity(data: AccountActivityEventsQuery): AccountActivityEventItem[] {
  const fromRows = data.activityEvents.items;

  const seen = new Set<string>();
  for (const row of fromRows) {
    for (const [, key] of BENEFICIARY_ROOTS) {
      const sub = row[key];
      if (sub && "id" in sub && sub.id) seen.add(`${key}:${sub.id}`);
    }
  }

  const merged: AccountActivityEventItem[] = [...fromRows];
  for (const [root, key] of BENEFICIARY_ROOTS) {
    for (const row of data[root]?.items ?? []) {
      if (seen.has(`${key}:${row.id}`)) continue;
      seen.add(`${key}:${row.id}`);
      const { chainId, project, ...sub } = row;
      merged.push({
        id: sub.id,
        chainId,
        timestamp: sub.timestamp,
        txHash: sub.txHash,
        from: sub.from,
        project,
        ...EMPTY_SUB_EVENTS,
        [key]: { ...sub, project: null },
      });
    }
  }

  return merged.sort((a, b) => b.timestamp - a.timestamp);
}
