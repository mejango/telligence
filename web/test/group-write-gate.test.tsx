import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Owner and operator writes take their (chainId, projectId) from the server
// sucker-group list (the indexer). The gate lets them target only pairs the
// on-chain sucker registry lists.

const state = vi.hoisted(() => ({
  verifiedPairs: [] as { peerChainId: number; projectId: bigint }[],
  isVerified: true,
  isError: false,
}));

vi.mock("@/lib/nana/suckers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nana/suckers")>()),
  useSuckers: () => state,
}));

const BASE = { chainId: 8453, projectId: 3 };
const OP = { chainId: 10, projectId: 4n };
const OP_INDEXED = { chainId: 10, projectId: 666 };

beforeEach(() => {
  state.verifiedPairs = [
    { peerChainId: 8453, projectId: 3n },
    { peerChainId: 10, projectId: 4n },
  ];
  state.isVerified = true;
  state.isError = false;
});

describe("useGroupWriteGate", () => {
  it("passes chain-verified targets, whatever their id type", () => {
    const { result } = renderHook(() => useGroupWriteGate([BASE, OP]));
    expect(result.current).toMatchObject({ blocked: false, pending: false, line: null });
    expect(() => result.current.assertVerified([BASE, OP])).not.toThrow();
  });

  it("blocks an indexer pair the registry does not list, with one line, at render and at send", () => {
    const { result } = renderHook(() => useGroupWriteGate([BASE, OP_INDEXED]));
    expect(result.current.blocked).toBe(true);
    expect(result.current.pending).toBe(false);
    expect(result.current.line).toBe("The Optimism project listed here isn't linked onchain.");
    expect(() => result.current.assertVerified([OP_INDEXED])).toThrow(
      "The Optimism project listed here isn't linked onchain.",
    );
  });

  it("is pending, with no line, while the registry read is in flight", () => {
    state.verifiedPairs = [{ peerChainId: 8453, projectId: 3n }];
    state.isVerified = false;
    const { result } = renderHook(() => useGroupWriteGate([BASE, OP]));
    expect(result.current).toMatchObject({ blocked: true, pending: true, line: null });
    expect(() => result.current.assertVerified([OP])).toThrow();
  });

  it("names a failed registry read", () => {
    state.verifiedPairs = [{ peerChainId: 8453, projectId: 3n }];
    state.isVerified = false;
    state.isError = true;
    const { result } = renderHook(() => useGroupWriteGate([OP]));
    expect(result.current.line).toBe("Couldn't confirm Optimism belongs to this project.");
  });
});
