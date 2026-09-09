import { jbRulesetsAbi } from "@bananapus/nana-sdk-core";
import type { Address, PublicClient } from "viem";

const RULESET_PAGE_SIZE = 100n;

export type RawRuleset = {
  cycleNumber: number;
  id: number;
  basedOnId: number;
  start: number;
  duration: number;
  weight: bigint;
  weightCutPercent: number;
  approvalHook: Address;
  metadata: bigint;
};

/**
 * Read a project's complete configured-ruleset chain. `allOf` returns newest
 * first and uses the last row's `basedOnId` as the cursor for older rows.
 * There is deliberately no product stage cap: repeated cursors are rejected
 * instead of silently returning a partial history.
 */
export async function readAllProjectRulesets(
  client: Pick<PublicClient, "readContract">,
  address: Address,
  projectId: bigint,
): Promise<RawRuleset[]> {
  const rows: RawRuleset[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let startingId = 0n;

  for (;;) {
    const page = (await client.readContract({
      address,
      abi: jbRulesetsAbi,
      functionName: "allOf",
      args: [projectId, startingId, RULESET_PAGE_SIZE],
    })) as readonly RawRuleset[];

    if (page.length === 0) break;
    for (const ruleset of page) {
      const id = String(ruleset.id);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        rows.push(ruleset);
      }
    }

    const next = BigInt(page[page.length - 1]?.basedOnId ?? 0);
    if (next === 0n) break;
    const cursor = next.toString();
    if (seenCursors.has(cursor)) {
      throw new Error("Ruleset history is cyclic and cannot be verified completely.");
    }
    seenCursors.add(cursor);
    startingId = next;
  }

  return rows;
}
