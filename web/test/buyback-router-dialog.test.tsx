import { BuybackRouterCard } from "@/app/[slug]/components/v6/operator/BuybackRouterCard";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The card reads chain state on mount; stub it so the test is about the shell,
// not the RPC. One chain with an initialized USDC pool = every action available.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        chainId: 8453,
        projectId: 6,
        buybackRegistry: "0x1111111111111111111111111111111111111111",
        routerRegistry: "0x2222222222222222222222222222222222222222",
        buybackAvailable: true,
        routerAvailable: true,
        hook: "0x3333333333333333333333333333333333333333",
        terminal: "0x4444444444444444444444444444444444444444",
        pools: [
          { label: "USDC", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", twap: 172800 },
        ],
        poolSummary: "USDC pool · TWAP 172800s",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeProposalPendingError: () => false,
}));
vi.mock("@/app/[slug]/components/v6/operator/useOperatorWrites", () => ({
  useOperatorWrites: () => ({ runWrites: vi.fn() }),
}));
// The live operator read needs bendystraw + RPC; the shell test has neither.
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: () => ({ operatorByChain: new Map(), isLoading: false }),
}));
// ENS lookups need a wagmi provider this test has no business standing up.
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: `0x${"22".repeat(20)}`, chainId: 8453 }),
  useChainId: () => 8453,
  useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false }),
}));

describe("BuybackRouterCard", () => {
  it("opens each action's form in a modal dialog, not inline", async () => {
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);

    // Closed: the form's fields are nowhere in the card.
    expect(screen.queryByText("Run on")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Set TWAP window" }));

    await waitFor(() => expect(screen.getByText("Run on")).toBeTruthy());
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    // The form lives INSIDE the dialog — an inline render would fail this.
    expect(dialog!.contains(screen.getByText("Run on"))).toBe(true);
    expect(dialog!.querySelector("input[type=checkbox]")).toBeTruthy();
  });

  it("pre-fills the pair token from the pool that exists", async () => {
    render(<BuybackRouterCard rows={[{ chainId: 8453, projectId: 6 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Set TWAP window" }));

    await waitFor(() => expect(screen.getByText("Run on")).toBeTruthy());
    const dialog = document.querySelector("dialog")!;
    const values = [...dialog.querySelectorAll("input")].map((input) => input.value);
    // USDC on Base, not the native sentinel — ART has no native pool.
    expect(values).toContain("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(values).toContain("172800");
  });
});
