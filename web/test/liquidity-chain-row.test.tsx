import { LiquidityChainRow } from "@/app/[slug]/components/v6/owners/market/AmmCard";
import type { AmmChainState, PoolSnapshot } from "@/app/[slug]/components/v6/owners/market/lib";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ composition: vi.fn(), positions: vi.fn() }));
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (original) => ({
  ...(await original<object>()),
  fetchPoolComposition: mocks.composition,
  readPoolLpPositions: mocks.positions,
}));

const pool = {
  chainId: 1,
  poolId: "0x01",
  price: 1,
  sqrtP: 2n ** 96n,
  pairIsC0: false,
  pair: { decimals: 18, symbol: "ETH" },
} as unknown as PoolSnapshot;
const state = {
  chainId: 1,
  hook: "0x01",
  pool,
  reference: { cashOut: null, issuance: null },
} as unknown as AmmChainState;
const reserves = { pairAmount: 10n ** 18n, tokenAmount: 10n ** 18n, ranges: [] };

function renderRow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LiquidityChainRow state={state} tokenSymbol="REV" />
    </QueryClientProvider>,
  );
}

describe("liquidity chain row", () => {
  beforeEach(() => {
    mocks.composition.mockReset();
    mocks.positions.mockReset();
  });

  it("recovers the reserves through Retry and keeps showing providers meanwhile", async () => {
    mocks.positions.mockResolvedValue([]);
    mocks.composition.mockRejectedValueOnce(new Error("RPC down"));
    mocks.composition.mockResolvedValue(reserves);
    renderRow();
    expect(await screen.findByText(/Could not load the reserves/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Composition")).toBeInTheDocument();
    expect(screen.queryByText(/Could not load the reserves/)).not.toBeInTheDocument();
  });

  it("keeps the reserves when only the providers fail, and retries the providers", async () => {
    mocks.composition.mockResolvedValue(reserves);
    mocks.positions.mockRejectedValueOnce(new Error("Could not verify"));
    mocks.positions.mockResolvedValue([]);
    renderRow();
    expect(await screen.findByText("Composition")).toBeInTheDocument();
    expect(await screen.findByText(/Could not load the providers/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(mocks.positions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(screen.queryByText(/Could not load the providers/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Composition")).toBeInTheDocument();
  });

  it("says an empty pool has no reserves rather than reporting a failure", async () => {
    mocks.positions.mockResolvedValue([]);
    mocks.composition.mockResolvedValue({ pairAmount: 0n, tokenAmount: 0n, ranges: [] });
    renderRow();
    expect(await screen.findByText("The pool has no active reserves.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
