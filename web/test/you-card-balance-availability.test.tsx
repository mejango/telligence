import { V6YouCard } from "@/app/[slug]/components/v6/owners/accounts/V6YouCard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ balances: {} as Record<string, unknown> }));
vi.mock("@/hooks/useViewedAccount", () => ({
  useViewedAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 8453,
  useJBContractContext: () => ({
    projectId: 3n,
    contractAddress: () => "0x2222222222222222222222222222222222222222",
    contracts: { primaryNativeTerminal: { data: undefined } },
  }),
  useJBTokenContext: () => ({ token: { data: { symbol: "$REV", decimals: 18 } } }),
}));
vi.mock("@/lib/nana/suckers", () => ({ useSuckersUserTokenBalance: () => state.balances }));
vi.mock("@/lib/bendystraw", () => ({
  useBendystrawQuery: () => ({}),
  ProjectOperation: {},
  SuckerGroupOperation: {},
}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({}),
  useReadContract: () => ({}),
  useReadContracts: () => ({}),
}));
vi.mock("@/app/[slug]/components/v6/owners/market/AmmCard", () => ({
  AddLiquidityForm: () => null,
  LiquidityManager: () => null,
}));

beforeEach(() => {
  state.balances = { data: [], isLoading: false, isError: false, isComplete: true };
});

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <V6YouCard projects={[]} />
    </QueryClientProvider>,
  );
}

it("does not claim the wallet holds nothing after a balance read fails", () => {
  state.balances = { data: [], isLoading: false, isError: true };
  show();
  expect(screen.getByText("Balances unavailable.")).toBeVisible();
  expect(screen.queryByText(/You don't hold/)).not.toBeInTheDocument();
});

it("still reports genuinely empty confirmed holdings", () => {
  show();
  expect(screen.getByText("You don't hold any REV yet.")).toBeVisible();
});

it("keeps unresolved balances distinct from confirmed empty holdings", () => {
  state.balances = { data: [], isLoading: false, isError: false, isComplete: false };
  show();
  expect(screen.getByText("Balances unavailable.")).toBeVisible();
  expect(screen.queryByText(/You don't hold/)).not.toBeInTheDocument();
});
