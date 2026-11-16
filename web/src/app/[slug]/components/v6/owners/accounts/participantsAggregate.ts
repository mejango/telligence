import { chainSortIndex } from "@/app/constants";

export type ParticipantInput = {
  address: string;
  chainId: number;
  balance?: string | number | bigint | null;
} | null;

export type AggregatedParticipant = {
  address: string;
  balance: bigint;
  chains: number[];
};

export type ParticipantCountSummary = {
  count: number;
  exact: boolean;
};

/** Each account's combined balance across the chains it holds on, largest first. */
export function aggregateParticipants(
  items: readonly ParticipantInput[] | undefined,
): AggregatedParticipant[] {
  const byAddress = new Map<string, AggregatedParticipant>();
  for (const participant of items ?? []) {
    if (!participant) continue;
    const key = participant.address.toLowerCase();
    const existing = byAddress.get(key) ?? {
      address: participant.address,
      balance: 0n,
      chains: [],
    };
    existing.balance += BigInt(participant.balance ?? 0);
    if (!existing.chains.includes(participant.chainId)) {
      existing.chains.push(participant.chainId);
    }
    byAddress.set(key, existing);
  }
  for (const row of byAddress.values()) {
    row.chains.sort((a, b) => chainSortIndex(a) - chainSortIndex(b));
  }
  // The indexer ranks per-chain rows, so a holder split across chains arrives out of order.
  return [...byAddress.values()].sort((a, b) =>
    a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1,
  );
}

/**
 * A unique holder count can only be exact when every indexed participant row
 * was fetched. Otherwise the deduplicated rows establish a lower bound.
 */
export function participantCountSummary(
  items: readonly ParticipantInput[] | undefined,
  totalCount: number | undefined,
): ParticipantCountSummary {
  const fetchedCount = items?.length ?? 0;
  return {
    count: aggregateParticipants(items).length,
    exact: typeof totalCount === "number" && totalCount <= fetchedCount,
  };
}
