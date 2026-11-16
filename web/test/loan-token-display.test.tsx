import { loanTokenMetadata } from "@/lib/tokenUtils";
import { NATIVE_TOKEN, USDC_ADDRESSES } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loans: [] as any[],
  projects: [] as any[],
  reads: vi.fn(),
  quotes: vi.fn(),
}));
vi.mock("wagmi", () => ({
  usePublicClient: () => ({ readContract: mocks.reads }),
  useReadContract: (args: any) => {
    mocks.quotes(args);
    return args.args ? { data: [0n, 2n * 10n ** 18n] } : { data: undefined };
  },
}));
vi.mock("@/hooks/useViewedAccount", () => ({ useViewedAccount: () => ({ address: undefined }) }));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteLoans: () => ({ data: mocks.loans }),
  useCompleteLoansByAccount: () => ({ data: mocks.loans }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBContractContext: () => ({ projectId: 10n }),
  useJBTokenContext: () => ({ token: { data: { decimals: 18, symbol: "REV" } } }),
}));
vi.mock("@/lib/bendystraw", () => ({
  ProjectOperation: { id: "project" },
  SuckerGroupOperation: { id: "group" },
  useBendystrawQuery: (op: any) => ({
    data:
      op.id === "project"
        ? { project: { suckerGroupId: "g" } }
        : { suckerGroup: { projects: { items: mocks.projects } } },
  }),
}));
vi.mock("@/lib/loanFees", () => ({ currentOutstandingLoanFee: () => 10n ** 17n }));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => <span>Ethereum</span> }));
vi.mock("@/components/EthereumAddress", () => ({ EthereumAddress: () => <span>Borrower</span> }));
vi.mock("@/components/WalletButton", () => ({
  WalletConnectButton: () => <button>Connect</button>,
}));
vi.mock("@/app/[slug]/components/Value/RepayDialog", () => ({ RepayDialog: () => null }));
vi.mock("@/app/[slug]/components/Value/ReallocateDialog", () => ({ ReallocateDialog: () => null }));

import { V6LoansSubtab } from "@/app/[slug]/components/v6/owners/V6LoansSubtab";
import { LoanDetailsTable } from "@/app/[slug]/components/Value/LoansDetailsTable";

const CUSTOM = "0x1111111111111111111111111111111111111111";
const primary = {
  chainId: 1,
  projectId: 10,
  token: USDC_ADDRESSES[1],
  decimals: 6,
  currency: 909516616,
  tokenSymbol: "USDC",
};
const nativeLoan = {
  id: "1",
  chainId: 1,
  projectId: 10,
  token: NATIVE_TOKEN,
  owner: CUSTOM,
  borrowAmount: `${10n ** 18n}`,
  collateral: `${100n * 10n ** 18n}`,
  createdAt: 1_700_000_000,
  prepaidDuration: 1000,
  prepaidFeePercent: 25,
};
let clients: QueryClient[] = [];
function show(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
beforeEach(() => {
  mocks.loans = [nativeLoan];
  mocks.projects = [primary];
  mocks.reads.mockRejectedValue(new Error("unavailable"));
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients = [];
});

describe("loan source display", () => {
  it("shows native source principal and fees in native units on a USDC-primary revnet", () => {
    show(<V6LoansSubtab projects={mocks.projects} />);
    expect(screen.getAllByText("1 ETH").length).toBeGreaterThan(0);
    expect(screen.getByText("0.1 ETH")).toBeTruthy();
    expect(screen.queryByText(/1,000,000,000,000/)).toBeNull();
    expect(mocks.reads).not.toHaveBeenCalled();
  });

  it("uses a matching custom source row instead of the native primary context, including zero decimals", () => {
    const projects = [
      {
        ...primary,
        token: NATIVE_TOKEN,
        decimals: 18,
        tokenSymbol: "ETH",
        projectTokenBalances: {
          items: [{ token: CUSTOM, tokenSymbol: "CUSTOM", decimals: 8, balance: "0" }],
        },
      },
    ];
    mocks.loans = [{ ...nativeLoan, token: CUSTOM, borrowAmount: "123000000" }];
    show(<V6LoansSubtab projects={projects} />);
    expect(screen.getByText("1.23 CUSTOM")).toBeTruthy();
    expect(mocks.reads).not.toHaveBeenCalled();
    expect(
      loanTokenMetadata({ ...nativeLoan, token: CUSTOM }, [
        {
          ...projects[0],
          projectTokenBalances: { items: [{ token: CUSTOM, tokenSymbol: "WHOLE", decimals: 0 }] },
        },
      ])?.decimals,
    ).toBe(0);
  });

  it("keeps unknown custom sources unavailable, with no primary-unit or wrong-chain fallback", async () => {
    mocks.loans = [{ ...nativeLoan, token: CUSTOM }];
    mocks.projects = [
      primary,
      { ...primary, chainId: 8453, token: CUSTOM, decimals: 8, tokenSymbol: "WRONG CHAIN" },
    ];
    show(<V6LoansSubtab projects={mocks.projects} />);
    await waitFor(() => expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0));
    expect(screen.queryByText(/WRONG CHAIN/)).toBeNull();
    expect(screen.queryByText(/1,000,000,000,000/)).toBeNull();
  });

  it("quotes Your loans in the exact secondary source currency and keeps row action identity", async () => {
    const context = { token: NATIVE_TOKEN, decimals: 18, currency: 61166 };
    mocks.reads.mockImplementation(
      async ({ functionName }: any) =>
        ({
          TERMINAL: CUSTOM,
          accountingContextsOf: [context],
          accountingContextForTokenOf: context,
        })[functionName as "TERMINAL"],
    );
    const select = vi.fn(),
      refinance = vi.fn();
    show(
      <LoanDetailsTable
        revnetId={10n}
        address={CUSTOM}
        tokenSymbol="REV"
        projects={mocks.projects}
        onSelectLoan={select}
        onReallocateLoan={refinance}
      />,
    );
    expect(screen.getAllByText("1 ETH").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Repay" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(
      mocks.quotes.mock.calls.some(([args]) => args.args?.[2] === 18n && args.args?.[3] === 61166n),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Repay" }).closest("td")?.className).toContain(
      "sticky",
    );
    expect(screen.getAllByText("1 ETH")[1]).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Repay" }));
    expect(select).toHaveBeenCalledWith("1", 1, 10);
    fireEvent.click(screen.getByRole("button", { name: "Refinance" }));
    expect(refinance).toHaveBeenCalledWith(nativeLoan);
  });

  it("does not quote, show zero capacity or enable actions when source lookup falls back to another token", async () => {
    const wrong = { token: USDC_ADDRESSES[1], decimals: 6, currency: 909516616 };
    mocks.reads.mockImplementation(
      async ({ functionName }: any) =>
        ({ TERMINAL: CUSTOM, accountingContextsOf: [wrong], accountingContextForTokenOf: wrong })[
          functionName as "TERMINAL"
        ],
    );
    show(
      <LoanDetailsTable
        revnetId={10n}
        address={CUSTOM}
        tokenSymbol="REV"
        projects={mocks.projects}
        onReallocateLoan={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Loan token context unavailable/)).toBeTruthy());
    expect((screen.getByRole("button", { name: "Repay" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Refinance" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mocks.quotes.mock.calls.every(([args]) => args.args === undefined)).toBe(true);
    const row = screen.getByRole("button", { name: "Repay" }).closest("tr")!;
    expect(within(row).getByText("Unavailable")).toBeTruthy();
    expect(within(row).queryByText("0 ETH")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
