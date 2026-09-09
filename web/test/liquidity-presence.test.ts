import type { JBChainId } from "@bananapus/nana-sdk-core";
import { describe, expect, it } from "vitest";

import {
  fetchAmmPresence,
  fetchAmmReferences,
  type PoolSnapshot,
} from "@/app/[slug]/components/v6/owners/market/lib";

// The "Add liquidity" button must gate on a cheap pool-existence
// probe: one snapshot read per chain, never the getLogs composition scan or
// reference-price quotes. These tests pin the probe's shape and its fail-soft
// behavior via injected readers.

const fakePool = { poolId: "0xpool", price: 0.00001 } as unknown as PoolSnapshot;
const HOOK = "0x0000000000000000000000000000000000000001" as const;

const chains = [
  { chainId: 8453 as JBChainId, projectId: 3n },
  { chainId: 1 as JBChainId, projectId: 5n },
];

describe("fetchAmmPresence", () => {
  it("returns one presence entry per chain from snapshot reads alone", async () => {
    const calls: number[] = [];
    const presence = await fetchAmmPresence(chains, async (chainId) => {
      calls.push(chainId);
      return { hook: HOOK, pool: fakePool };
    });
    expect(calls).toEqual([8453, 1]);
    expect(presence).toEqual([
      { chainId: 8453, projectId: 3n, hook: HOOK, pool: fakePool },
      { chainId: 1, projectId: 5n, hook: HOOK, pool: fakePool },
    ]);
  });

  it("maps a failed chain to an empty presence instead of rejecting", async () => {
    const presence = await fetchAmmPresence(chains, async (chainId) => {
      if (chainId === 1) throw new Error("rpc down");
      return { hook: HOOK, pool: fakePool };
    });
    expect(presence[0].pool).toBe(fakePool);
    expect(presence[1]).toEqual({ chainId: 1, projectId: 5n, hook: null, pool: null });
  });
});

describe("fetchAmmReferences", () => {
  it("expands pooled presences into dialog-ready states without a composition scan", async () => {
    const presence = [
      { chainId: 8453 as JBChainId, projectId: 3n, hook: HOOK, pool: fakePool },
      { chainId: 1 as JBChainId, projectId: 5n, hook: null, pool: null },
    ];
    const states = await fetchAmmReferences(presence, async () => ({
      issuance: 0.0016,
      cashOut: 6.68961e-8,
    }));
    expect(states).toEqual([
      {
        chainId: 8453,
        hook: HOOK,
        pool: fakePool,
        composition: null,
        reference: { issuance: 0.0016, cashOut: 6.68961e-8 },
      },
      {
        chainId: 1,
        hook: null,
        pool: null,
        composition: null,
        reference: { issuance: null, cashOut: null },
      },
    ]);
  });

  it("keeps the state when a reference quote fails", async () => {
    const presence = [{ chainId: 8453 as JBChainId, projectId: 3n, hook: HOOK, pool: fakePool }];
    const states = await fetchAmmReferences(presence, async () => {
      throw new Error("no feed");
    });
    expect(states[0].pool).toBe(fakePool);
    expect(states[0].reference).toEqual({ issuance: null, cashOut: null });
  });
});
