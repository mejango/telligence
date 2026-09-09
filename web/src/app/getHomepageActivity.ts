import "server-only";

import { ActivityEventsOperation, ProjectErc20TickersOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ActivityEventsQuery } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { getIssuanceFingerprint } from "@/lib/issuanceFingerprint.server";
import type { JBChainId } from "@bananapus/nana-sdk-core";

export type HomepageRawActivity = ActivityEventsQuery["activityEvents"]["items"][number] & {
  issuanceFingerprint?: number[];
  /**
   * The project ERC-20's ticker — what token amounts in the row are denominated
   * in. The project row's `tokenSymbol` names the ACCOUNTING context's token
   * (ETH, USDC), so it must never label a project-token amount.
   */
  tokenTicker?: string;
};

/** Project ERC-20 tickers for the (chain, project) pairs on a page, keyed `chainId:projectId`. */
async function tickersFor(events: HomepageRawActivity[]) {
  const empty = new Map<string, string>();
  const chainIds = [...new Set(events.map((event) => event.chainId))];
  const projectIds = [
    ...new Set(events.flatMap((event) => (event.project ? [event.project.projectId] : []))),
  ];
  if (!chainIds.length || !projectIds.length) return empty;
  try {
    const data = await queryBendystraw(mainnet.id, ProjectErc20TickersOperation, {
      where: { chainId_in: chainIds, projectId_in: projectIds, version: 6 },
      limit: 200,
    });
    return new Map(
      (data.deployErc20Events.items ?? []).map((row) => [
        `${row.chainId}:${row.projectId}`,
        row.symbol,
      ]),
    );
  } catch {
    // A missing ticker degrades to "tokens" — it must not cost the whole feed.
    return empty;
  }
}

function relevant(event: HomepageRawActivity) {
  return !!(
    event.project?.isRevnet &&
    (event.payEvent ||
      event.cashOutTokensEvent ||
      event.swapEvent ||
      event.sendPayoutsEvent ||
      event.rulesetQueuedEvent ||
      event.projectCreateEvent ||
      event.addToBalanceEvent)
  );
}

export async function getHomepageActivityPage(limit = 8, offset = 0) {
  try {
    const wanted = offset + limit;
    const matches: HomepageRawActivity[] = [];
    let sourceOffset = 0;
    let totalCount = Number.POSITIVE_INFINITY;
    while (matches.length < wanted && sourceOffset < totalCount) {
      const data = await queryBendystraw(mainnet.id, ActivityEventsOperation, {
        where: { version: 6 },
        orderBy: "timestamp",
        orderDirection: "desc",
        limit: 100,
        offset: sourceOffset,
      });
      const items = data.activityEvents.items ?? [];
      totalCount = data.activityEvents.totalCount ?? sourceOffset + items.length;
      matches.push(...items.filter(relevant));
      sourceOffset += items.length;
      if (!items.length) break;
    }
    const page = matches.slice(offset, wanted);
    const tickers = await tickersFor(page);
    const fingerprints = new Map<string, Promise<number[]>>();
    return Promise.all(
      page.map(async (event) => {
        const key = `${event.chainId}:${event.project?.projectId ?? 0}`;
        if (event.project && !fingerprints.has(key)) {
          fingerprints.set(
            key,
            getIssuanceFingerprint(event.project.projectId, event.chainId as JBChainId),
          );
        }
        return {
          ...event,
          issuanceFingerprint: (await fingerprints.get(key)) ?? [],
          tokenTicker: tickers.get(key),
        };
      }),
    );
  } catch {
    return [];
  }
}
