import type { JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddLiquidityForm } from "@/app/[slug]/components/v6/owners/market/AmmCard";
import type { AmmChainState, PoolSnapshot } from "@/app/[slug]/components/v6/owners/market/lib";

// Render-level lock on the redesigned add-liquidity form: amounts-first by
// default (both fields typed, range solved and explained), with a range mode
// whose derived amount is visibly automatic.

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  useConfig: () => ({}),
  usePublicClient: () => undefined,
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    ...props
  }: {
    children: React.ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/hooks/useAllowance", () => ({
  useAllowance: () => ({ ensureAllowance: vi.fn(), isApproving: false }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnection: () => false,
  submittedViaSafe: () => false,
  useWaitForTransactionReceipt: () => ({}),
  useWriteContract: () => ({ writeContractAsync: vi.fn(), isPending: false }),
}));

const pool = {
  chainId: 8453 as JBChainId,
  price: 0.00001,
  poolId: "0xpool",
  pair: {
    addr: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
    currency: 1n,
  },
} as unknown as PoolSnapshot;

const state: AmmChainState = {
  chainId: 8453 as JBChainId,
  hook: "0x0000000000000000000000000000000000000001",
  pool,
  composition: null,
  reference: { cashOut: 6.68961e-8, issuance: 0.0016 },
};

const render = (ui: React.ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("AddLiquidityForm", () => {
  it("defaults to making the market with independent amounts on each side of the price", () => {
    render(<AddLiquidityForm state={state} tokenSymbol="MARKEE" />);

    // The mode toggle and the main action share the name; there is no Review step.
    expect(screen.getAllByRole("button", { name: "Make the market" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full range" })).not.toBeInTheDocument();
    expect(screen.queryByText("Min price")).not.toBeInTheDocument();
    expect(screen.getByText("MARKEE to sell above the price")).toBeInTheDocument();
    expect(screen.getByText("ETH to buy with below the price")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "20000000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });

    // Both amounts are used in full: nothing is derived from the other side,
    // and the corridor line is the only guidance.
    expect(screen.queryByText(/Makes the market/)).not.toBeInTheDocument();
    expect(screen.getByText(/independent and used in full/)).toBeInTheDocument();
  });

  it("still offers the solved single band under By amounts", () => {
    render(<AddLiquidityForm state={state} tokenSymbol="MARKEE" />);

    fireEvent.click(screen.getByRole("button", { name: "By amounts" }));
    expect(screen.queryByText("Min price")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "100000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });

    expect(screen.getByText(/Uses your 100000 MARKEE \+ 0\.08 ETH/)).toBeInTheDocument();
    expect(screen.getByText(/issuance price/)).toBeInTheDocument();
  });

  it("switches to range mode with the solved range carried over and a derived amount", () => {
    render(<AddLiquidityForm state={state} tokenSymbol="MARKEE" />);

    fireEvent.click(screen.getByRole("button", { name: "By amounts" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });
    fireEvent.click(screen.getByRole("button", { name: "By price range" }));

    expect(screen.getByText("Min price")).toBeInTheDocument();
    expect(screen.getByText("Max price")).toBeInTheDocument();
    const minInput = screen.getByRole("spinbutton", { name: "Min price" }) as HTMLInputElement;
    expect(Number(minInput.value)).toBeCloseTo(6.68961e-8, 12);

    // Typing a token amount derives the pair side and marks it automatic.
    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "2000" },
    });
    expect(screen.getByText("≈ auto")).toBeInTheDocument();
    const pairInput = screen.getByRole("spinbutton", { name: /^ETH/ }) as HTMLInputElement;
    expect(Number(pairInput.value)).toBeGreaterThan(0);
  });
});
