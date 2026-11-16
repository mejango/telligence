import { useSuckers, useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import { JBProjectToken } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page seeds the sucker group from the indexer so it renders without a
// waterfall. Pay, cash out, split and payer writes build calldata from a peer's
// (chainId, projectId), so the seed must never be what reaches them: the
// on-chain registry is read on every mount, and only its pairs are writable.

const mocks = vi.hoisted(() => ({
  resolveSuckers: vi.fn(),
  initialSuckers: [] as { peerChainId: number; projectId: bigint }[],
  balanceOf: vi.fn(),
  homeBalance: undefined as unknown,
  homeLoading: false,
  homeError: false,
}));

vi.mock("@bananapus/nana-sdk-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core")>()),
  resolveSuckers: mocks.resolveSuckers,
}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useConfig: () => ({ getClient: () => ({}) }),
  // The home balance, read directly on the page's chain.
  useReadContract: () => ({
    data: mocks.homeBalance,
    isLoading: mocks.homeLoading,
    isError: mocks.homeError,
    error: null,
  }),
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  getContract: () => ({ read: { totalBalanceOf: mocks.balanceOf } }),
}));
vi.mock("@/hooks/useViewedAccount", () => ({
  useViewedAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 8453,
  useJBContractContext: () => ({
    projectId: 3n,
    contractAddress: () => "0x2222222222222222222222222222222222222222",
  }),
  useJBProject: () => ({ initialSuckers: mocks.initialSuckers }),
}));

const HOME = { peerChainId: 8453, projectId: 3n };
// What a wrong or compromised indexer lists: the right chain, another project.
const INDEXED_PEER = { peerChainId: 10, projectId: 666n };
const ONCHAIN_PEER = { peerChainId: 10, projectId: 4n };

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mocks.resolveSuckers.mockReset();
  mocks.balanceOf.mockReset().mockResolvedValue(5n);
  mocks.homeBalance = new JBProjectToken(7n);
  mocks.homeLoading = false;
  mocks.homeError = false;
  mocks.initialSuckers = [INDEXED_PEER];
});

describe("useSuckers over an indexer seed", () => {
  it("shows the seed at once but writes only to the page's own pair until the registry read lands", async () => {
    let resolve!: (pairs: (typeof HOME)[]) => void;
    mocks.resolveSuckers.mockReturnValue(new Promise((done) => (resolve = done)));
    const { result } = renderHook(() => useSuckers(), { wrapper: wrapper() });

    expect(result.current.data).toEqual([HOME, INDEXED_PEER]);
    expect(result.current.isVerified).toBe(false);
    expect(result.current.verifiedPairs).toEqual([HOME]);
    await waitFor(() => expect(mocks.resolveSuckers).toHaveBeenCalledTimes(1));

    resolve([HOME, ONCHAIN_PEER]);
    await waitFor(() => expect(result.current.isVerified).toBe(true));
    expect(result.current.data).toEqual([HOME, ONCHAIN_PEER]);
    expect(result.current.verifiedPairs).toEqual([HOME, ONCHAIN_PEER]);
  });

  it("keeps the seed for display but no peer writable when the registry read fails", async () => {
    mocks.resolveSuckers.mockRejectedValue(new Error("registry read failed"));
    const { result } = renderHook(() => useSuckers(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([HOME, INDEXED_PEER]);
    expect(result.current.isVerified).toBe(false);
    expect(result.current.verifiedPairs).toEqual([HOME]);
  });
});

describe("useSuckersUserTokenBalance", () => {
  it.each([false, true])(
    "does not invent a zero home balance when its read fails (peer: %s)",
    async (withPeer) => {
      mocks.homeBalance = undefined;
      mocks.homeError = true;
      mocks.resolveSuckers.mockResolvedValue(withPeer ? [HOME, ONCHAIN_PEER] : [HOME]);
      const { result } = renderHook(() => useSuckersUserTokenBalance(), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.isError).toBe(true);
      expect(result.current.isComplete).toBe(false);
      expect(result.current.data?.map((row) => row.projectId)).toEqual(withPeer ? [4n] : []);
    },
  );

  it("keeps a missing nonloading home balance incomplete even without an explicit error", async () => {
    mocks.homeBalance = undefined;
    mocks.resolveSuckers.mockResolvedValue([HOME, ONCHAIN_PEER]);
    const { result } = renderHook(() => useSuckersUserTokenBalance(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.data?.map((row) => row.projectId)).toEqual([4n]);
  });

  it("keeps a confirmed zero balance", async () => {
    mocks.homeBalance = new JBProjectToken(0n);
    mocks.resolveSuckers.mockResolvedValue([HOME]);
    const { result } = renderHook(() => useSuckersUserTokenBalance(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.data).toEqual([
      { balance: new JBProjectToken(0n), chainId: 8453, projectId: 3n },
    ]);
  });

  it("lists a balance only for chain-verified pairs, since borrow, burn and claims act on them", async () => {
    let resolve!: (pairs: (typeof HOME)[]) => void;
    mocks.resolveSuckers.mockReturnValue(new Promise((done) => (resolve = done)));
    const { result } = renderHook(() => useSuckersUserTokenBalance(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.map((row) => row.projectId)).toEqual([3n]);
    expect(result.current.isLoading).toBe(true);
    expect(mocks.balanceOf).not.toHaveBeenCalledWith([expect.anything(), 666n]);

    // The peer's balance read is slow: the home row stays shown meanwhile.
    let peerBalance!: (value: bigint) => void;
    mocks.balanceOf.mockReturnValue(new Promise((done) => (peerBalance = done)));
    resolve([HOME, ONCHAIN_PEER]);
    await waitFor(() => expect(mocks.balanceOf).toHaveBeenCalled());
    expect(result.current.data!.map((row) => row.projectId)).toEqual([3n]);
    peerBalance(5n);
    await waitFor(() => expect(result.current.data!.map((row) => row.projectId)).toEqual([3n, 4n]));
    expect(mocks.balanceOf).not.toHaveBeenCalledWith([expect.anything(), 666n]);
  });

  it("keeps the home balance when a verified peer's balance read fails", async () => {
    mocks.resolveSuckers.mockResolvedValue([HOME, ONCHAIN_PEER]);
    mocks.balanceOf.mockRejectedValue(new Error("peer RPC down"));
    const { result } = renderHook(() => useSuckersUserTokenBalance(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data!.map((row) => row.projectId)).toEqual([3n]);
  });
});
