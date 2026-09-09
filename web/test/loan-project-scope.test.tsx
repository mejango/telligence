import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V6 project ids are a per-chain namespace: the same revnet is project #7 on the route
 * chain and #9 on Base. Every per-loan quote must be keyed on the LOAN's own
 * (chainId, projectId) — quoting the route chain's id on the loan's chain prices a
 * different revnet, and that number becomes the reallocation tx's collateral-transfer
 * argument with every contract check still passing.
 */

const ROUTE_PROJECT_ID = 7n;
const LOAN_CHAIN_ID = 8453;
const LOAN_PROJECT_ID = 9n;
const LOAN_COLLATERAL = 1000n * 10n ** 18n;
const LOAN_BORROW_AMOUNT = 100n;
const BORROWABLE_NOW = 150n;
const BORROWABLE_CAPACITY = 300n;

const mocks = vi.hoisted(() => ({
  borrowableReads: [] as Array<{ chainId?: number; args: readonly bigint[] }>,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000dEaD" }),
  usePublicClient: () => undefined,
  useWalletClient: () => ({ data: undefined }),
  useReadContract: (config: {
    functionName?: string;
    chainId?: number;
    args?: readonly bigint[];
  }) => {
    if (config?.functionName !== "borrowableAmountFrom") return { data: undefined };
    if (!config.args) return { data: undefined };
    mocks.borrowableReads.push({ chainId: config.chainId, args: config.args });
    return { data: [BORROWABLE_NOW, BORROWABLE_CAPACITY] };
  },
}));

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeProposalPendingError: () => false,
  requireOnchainExecution: () => undefined,
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
  useWriteContract: () => ({ writeContractAsync: vi.fn(), isPending: false, data: undefined }),
}));

vi.mock("@/lib/bendystraw", () => ({
  LoansByAccountOperation: { id: "LoansByAccount" },
  ProjectOperation: { id: "Project" },
  SuckerGroupOperation: { id: "SuckerGroup" },
  useBendystrawQuery: () => ({ data: undefined }),
}));

vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBContractContext: () => ({ contractAddress: () => undefined }),
  useJBTokenContext: () => ({ token: { data: { decimals: 18, symbol: "REV" } } }),
}));

vi.mock("@/lib/nana/suckers", () => ({
  // The loan's chain is deliberately MISSING from the resolved sucker pairs, so the
  // `effectiveProjectId` fallback resolves to the route id — the loan row's own
  // projectId must still win for every per-loan quote.
  useSuckersUserTokenBalance: () => ({
    data: [
      { chainId: 1, projectId: Number(ROUTE_PROJECT_ID), balance: { value: 5n * 10n ** 18n } },
    ],
  }),
}));

vi.mock("@/hooks/useProjectBaseToken", () => ({
  useProjectBaseToken: () => ({}),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

vi.mock("@/lib/tokenUtils", () => ({
  getTokenConfigForChain: () => ({
    token: "0x000000000000000000000000000000000000EEEe",
    decimals: 18,
    currency: 61166,
    symbol: "ETH",
  }),
  getTokenSymbolFromAddress: () => "ETH",
  isNativeToken: () => true,
}));

vi.mock("@/components/ChainLogo", () => ({
  ChainLogo: ({ chainId }: { chainId: number }) => <span>chain-{chainId}</span>,
}));

import { isLoanForRevnet } from "@/app/[slug]/components/Value/LoansDetailsTable";
import { useBorrowDialog } from "@/app/[slug]/components/Value/hooks/useBorrowDialog";

const LOAN = {
  id: "9000000000001",
  chainId: LOAN_CHAIN_ID,
  projectId: Number(LOAN_PROJECT_ID),
  borrowAmount: LOAN_BORROW_AMOUNT.toString(),
  collateral: LOAN_COLLATERAL.toString(),
};

beforeEach(() => {
  mocks.borrowableReads.length = 0;
});

describe("wallet-action:loans — per-loan quotes use the loan's own (chainId, projectId)", () => {
  it("keys every reallocation quote for a chain-B loan on chain B's projectId, not the route's", async () => {
    const { result } = renderHook(() =>
      useBorrowDialog({ projectId: ROUTE_PROJECT_ID, selectedLoan: LOAN }),
    );

    await act(async () => {
      result.current.setCollateralAmount("10");
    });

    const expectedHeadroom = BORROWABLE_CAPACITY - LOAN_BORROW_AMOUNT;
    const expectedTransfer = (expectedHeadroom * LOAN_COLLATERAL) / BORROWABLE_CAPACITY;
    const addedCollateral = 10n * 10n ** 18n;

    // The three per-loan quotes: existing collateral, combined collateral, and the new
    // loan's collateral after the headroom transfer.
    for (const collateralCount of [
      LOAN_COLLATERAL,
      LOAN_COLLATERAL + addedCollateral,
      expectedTransfer + addedCollateral,
    ]) {
      const reads = mocks.borrowableReads.filter((read) => read.args[1] === collateralCount);
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) {
        expect(read.chainId).toBe(LOAN_CHAIN_ID);
        expect(read.args[0]).toBe(LOAN_PROJECT_ID);
      }
    }

    // The existing collateral is valued at the ECONOMIC ceiling (tuple[1]) — the quote
    // the contract's reallocation solvency check uses — never the treasury-capped
    // tuple[0], which collapses the headroom when the treasury is drawn down.
    expect(result.current.collateralHeadroom).toBe(expectedHeadroom);
    expect(result.current.collateralCountToTransfer).toBe(expectedTransfer);

    // The NEW loan's slippage floor still derives from tuple[0]: opening the borrow
    // draws live funds, so the treasury-capped quote is the honest floor.
    expect(result.current.minimumBorrowAmountPreview).toBe((BORROWABLE_NOW * 9_900n) / 10_000n);
  });
});

describe("loans table membership is the (chainId, projectId) pair", () => {
  const projects = [
    { chainId: 1, projectId: Number(ROUTE_PROJECT_ID) },
    { chainId: LOAN_CHAIN_ID, projectId: Number(LOAN_PROJECT_ID) },
  ];

  it("admits loans matching a pair on either chain", () => {
    expect(isLoanForRevnet({ chainId: 1, projectId: 7 }, projects)).toBe(true);
    expect(isLoanForRevnet({ chainId: LOAN_CHAIN_ID, projectId: 9 }, projects)).toBe(true);
  });

  it("rejects a foreign loan whose chain-local id collides with another chain's id", () => {
    expect(isLoanForRevnet({ chainId: LOAN_CHAIN_ID, projectId: 7 }, projects)).toBe(false);
    expect(isLoanForRevnet({ chainId: 1, projectId: 9 }, projects)).toBe(false);
  });
});
