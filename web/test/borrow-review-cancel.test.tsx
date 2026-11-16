import { SAFE_PROPOSAL_PENDING_LINE } from "@/lib/reviewed-call";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ETH_CONTEXT, LOAN_REVNET_ID } = vi.hoisted(() => ({
  ETH_CONTEXT: {
    token: "0x000000000000000000000000000000000000EEEe",
    decimals: 18,
    currency: 61166,
  },
  LOAN_REVNET_ID: 7n,
}));

let queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  toast: vi.fn(),
  hasPermissions: vi.fn(),
  // How a sent loan step ends.
  end: vi.fn(),
  run: undefined as unknown as import("vitest").Mock,
  reset: (() => undefined) as () => void,
  holdReview: (() => () => undefined) as () => () => void,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000dEaD" }),
  // The loans contract's own reads of the loan source: ETH, 18 decimals, on its terminal.
  usePublicClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) =>
      ({
        TERMINAL: "0x5555555555555555555555555555555555555555",
        accountingContextsOf: [ETH_CONTEXT],
        accountingContextForTokenOf: ETH_CONTEXT,
        revnetIdOfLoanWith: LOAN_REVNET_ID,
        loanOf: { amount: 1n, collateral: 1n, sourceToken: ETH_CONTEXT.token },
        borrowableAmountFrom: [10n ** 18n, 0n],
      })[functionName],
  }),
  useWalletClient: () => ({ data: {} }),
  useReadContract: ({ functionName }: { functionName?: string }) => ({
    data: functionName === "PERMISSIONS" ? "0x0000000000000000000000000000000000000004" : undefined,
  }),
  // The chain's own receipt read, which a Safe proposal never makes.
  useWaitForTransactionReceipt: () => ({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isSuccess: false,
  }),
}));

vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { liveReviewedAction } = await import("./support/reviewed-action");
  const runner = liveReviewedAction(mocks.write, (hash) => mocks.end(hash));
  mocks.run = runner.run;
  mocks.reset = runner.reset;
  mocks.holdReview = runner.holdReview;
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: runner.hook,
  };
});

vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  hasPermissions: mocks.hasPermissions,
}));

vi.mock("@/lib/bendystraw", () => ({
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
  useSuckersUserTokenBalance: () => ({
    data: [{ chainId: 1, projectId: 7, balance: { value: 5n * 10n ** 18n } }],
  }),
}));

vi.mock("@/hooks/useProjectBaseToken", () => ({ useProjectBaseToken: () => ({}) }));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
  toast: mocks.toast,
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

import { useBorrowDialog } from "@/app/[slug]/components/Value/hooks/useBorrowDialog";

beforeEach(() => {
  queryClient = new QueryClient();
  window.localStorage.clear();
  mocks.reset();
  mocks.end.mockReset();
  mocks.write.mockReset();
  mocks.hasPermissions.mockResolvedValue(false);
});

describe("a closed permission review", () => {
  it("wallet-action:loans returns the borrow flow to its start without reporting a denied permission", async () => {
    mocks.run.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n }), { wrapper });

    act(() => result.current.handleChainSelection(1));
    act(() => result.current.setCollateralAmount("1"));
    await waitFor(() => expect(result.current.selectedChainTokenConfig).toBeTruthy());
    await act(() => result.current.handleBorrow());

    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.run.mock.calls[0][0].calls[0].functionName).toBe("setPermissionsFor");
    expect(result.current.borrowStatus).toBe("idle");
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe("a permission step that went to the Safe as a proposal", () => {
  it("wallet-action:loans says it waits in the Safe, and neither that permission was denied nor that it failed", async () => {
    const proposal = `0x${"ab".repeat(32)}` as Hex;
    mocks.write.mockResolvedValue(proposal);
    mocks.end.mockReturnValue({ phase: "proposed" });
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n }), { wrapper });

    act(() => result.current.handleChainSelection(1));
    act(() => result.current.setCollateralAmount("1"));
    await waitFor(() => expect(result.current.selectedChainTokenConfig).toBeTruthy());
    await act(() => result.current.handleBorrow());

    expect(result.current.borrowStatus).toBe("proposed");
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: "Safe permission proposal submitted",
      description: SAFE_PROPOSAL_PENDING_LINE,
    });
  });
});

describe("a refinance whose permission check can't be read", () => {
  // One loan for every render, as the page passes it.
  const LOAN = {
    id: "3",
    chainId: 1,
    borrowAmount: (10n ** 18n).toString(),
    collateral: (2n * 10n ** 18n).toString(),
    projectId: 7,
  };

  it("ends in an error the dialog can be closed from, instead of holding the check", async () => {
    mocks.hasPermissions.mockRejectedValue(new Error("The node can't be reached."));
    // The loan names its own chain.
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n, selectedLoan: LOAN }), {
      wrapper,
    });
    // Adding collateral needs the permission check.
    act(() => result.current.setCollateralAmount("1"));
    await waitFor(() => expect(result.current.selectedChainTokenConfig).toBeTruthy());

    await act(() => result.current.handleBorrow());

    expect(mocks.hasPermissions).toHaveBeenCalledTimes(1);
    expect(result.current.internalSelectedLoan).toBe(LOAN);
    expect(result.current.borrowStatus).toBe("error");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});

describe("a second loan in the same mounted dialog", () => {
  it("wallet-action:loans shows no failure while the second loan is in review", async () => {
    mocks.write.mockResolvedValue(`0x${"cd".repeat(32)}`);
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n }), { wrapper });
    const choose = async () => {
      act(() => result.current.handleChainSelection(1));
      act(() => result.current.setCollateralAmount("1"));
      await waitFor(() => expect(result.current.selectedChainTokenConfig).toBeTruthy());
    };

    act(() => result.current.handleOpenChange(true));
    await choose();
    await act(() => result.current.handleBorrow());
    expect(result.current.borrowStatus).toBe("success");

    act(() => result.current.handleOpenChange(false));
    expect(result.current.borrowStatus).toBe("idle");
    act(() => result.current.handleOpenChange(true));
    await choose();
    const release = mocks.holdReview();
    let second: Promise<unknown> | undefined;
    act(() => {
      second = result.current.handleBorrow();
    });
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));

    expect(result.current.borrowStatus).not.toBe("error");
    expect(result.current.borrowStatus).toBe("checking");
    release();
    await act(() => second!);
    expect(result.current.borrowStatus).toBe("success");
  });
});
