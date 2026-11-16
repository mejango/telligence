import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ETH_CONTEXT } = vi.hoisted(() => ({
  ETH_CONTEXT: {
    token: "0x000000000000000000000000000000000000EEEe",
    decimals: 18,
    currency: 61166,
  },
}));

let queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

type RunnerState = {
  phase: string;
  held: null;
  error: string | null;
  settledStep: number | null;
};
type Runner = {
  state: RunnerState;
  set: (patch: Partial<RunnerState>) => void;
  run: import("vitest").Mock;
};

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  hasPermissions: vi.fn(),
  // Each useReviewedAction the dialog mounts, in mount order: borrow, then reallocation.
  runners: [] as Runner[],
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000dEaD" }),
  usePublicClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) =>
      ({
        TERMINAL: "0x5555555555555555555555555555555555555555",
        accountingContextsOf: [ETH_CONTEXT],
        accountingContextForTokenOf: ETH_CONTEXT,
        revnetIdOfLoanWith: 7n,
        loanOf: { amount: 1n, collateral: 1n, sourceToken: ETH_CONTEXT.token },
        borrowableAmountFrom: [10n ** 18n, 0n],
      })[functionName],
  }),
  useWalletClient: () => ({ data: {} }),
  useReadContract: ({ functionName }: { functionName?: string }) => ({
    data: functionName === "PERMISSIONS" ? "0x0000000000000000000000000000000000000004" : undefined,
  }),
}));

// Each runner keeps its own phase and settled step, as each useReviewedAction does.
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionState } = await import("./support/reviewed-action");
  const { useReducer, useState } = await import("react");
  function useRunner() {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    const [runner] = useState(() => {
      const state: RunnerState = { phase: "idle", held: null, error: null, settledStep: null };
      const own: Runner = {
        state,
        set: (patch) => {
          Object.assign(state, patch);
          rerender();
        },
        run: vi.fn(),
      };
      mocks.runners.push(own);
      return own;
    });
    return {
      ...reviewedActionState(runner.run),
      ...runner.state,
      busy: ["review", "simulating", "signing", "receipt"].includes(runner.state.phase),
      run: runner.run,
    };
  }
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: useRunner,
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

const LOAN = {
  id: "3",
  chainId: 1,
  borrowAmount: (10n ** 18n).toString(),
  collateral: (2n * 10n ** 18n).toString(),
  projectId: 7,
};

beforeEach(() => {
  queryClient = new QueryClient();
  mocks.runners.length = 0;
  mocks.hasPermissions.mockResolvedValue(false);
});

describe("a refinance whose permission a Safe executes after the run ended", () => {
  it("wallet-action:loans returns to its start, then refinances from the next review", async () => {
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n, selectedLoan: LOAN }), {
      wrapper,
    });
    const [borrow, reallocation] = mocks.runners;
    // The grant goes to the Safe as a proposal, and the run ends there.
    reallocation.run.mockImplementationOnce(
      async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
        expect(action.calls[0].functionName).toBe("setPermissionsFor");
        await action.beforeWallet?.(action.calls[0], 0);
        reallocation.set({ phase: "proposed" });
        return { status: "proposed", step: 0, safeTxHash: `0x${"ab".repeat(32)}` as Hex };
      },
    );

    // Adding collateral needs the burn permission.
    act(() => result.current.setCollateralAmount("1"));
    await waitFor(() => expect(result.current.selectedChainTokenConfig).toBeTruthy());
    await act(() => result.current.handleBorrow());
    expect(result.current.borrowStatus).toBe("proposed");

    // The Safe executes the grant: the runner is idle with its first step settled.
    act(() => reallocation.set({ phase: "idle", settledStep: 0 }));
    expect(result.current.borrowStatus).toBe("idle");
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Safe granted the permission",
      description: "Review the loan again to refinance.",
    });

    // The permission now reads as granted, so the next review sends the refinance alone.
    mocks.hasPermissions.mockResolvedValue(true);
    reallocation.run.mockImplementationOnce(
      async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
        expect(action.calls.map((call) => call.functionName)).toEqual([
          "reallocateCollateralFromLoan",
        ]);
        await action.beforeWallet?.(action.calls[0], 0);
        reallocation.set({ phase: "done", settledStep: null });
        return { status: "done", hashes: [`0x${"cd".repeat(32)}`], receipts: [] };
      },
    );
    await act(() => result.current.handleBorrow());

    expect(reallocation.run).toHaveBeenCalledTimes(2);
    expect(borrow.run).not.toHaveBeenCalled();
    expect(result.current.borrowStatus).toBe("success");
  });
});

describe("a loan proposal released from another tab", () => {
  it("wallet-action:loans returns to its start, then opens the loan from the next review", async () => {
    mocks.hasPermissions.mockResolvedValue(true);
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n }), { wrapper });
    const [borrow, reallocation] = mocks.runners;
    // The loan goes to the Safe as a proposal, and the run follows its hold.
    borrow.run.mockImplementationOnce(
      async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
        expect(action.calls.map((call) => call.functionName)).toEqual(["borrowFrom"]);
        await action.beforeWallet?.(action.calls[0], 0);
        borrow.set({ phase: "proposed" });
        return { status: "proposed", step: 0, safeTxHash: `0x${"ab".repeat(32)}` as Hex };
      },
    );

    act(() => result.current.handleChainSelection(1));
    act(() => result.current.setCollateralAmount("1"));
    await waitFor(() => expect(result.current.selectedChainTokenConfig).toBeTruthy());
    await act(() => result.current.handleBorrow());
    expect(result.current.borrowStatus).toBe("proposed");

    // Released in another tab: the runner is idle, with no error, hold or settled step.
    act(() => borrow.set({ phase: "idle" }));
    expect(result.current.borrowStatus).toBe("idle");

    // The next run's runner is still idle while it starts: that is the new send, not a release.
    let start!: () => void;
    const started = new Promise<void>((resolve) => (start = resolve));
    borrow.run.mockImplementationOnce(
      async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
        await started;
        await action.beforeWallet?.(action.calls[0], 0);
        borrow.set({ phase: "done" });
        return { status: "done", hashes: [`0x${"cd".repeat(32)}`], receipts: [] };
      },
    );
    let retry: Promise<unknown> | undefined;
    act(() => {
      retry = result.current.handleBorrow();
    });
    await waitFor(() => expect(borrow.run).toHaveBeenCalledTimes(2));
    expect(result.current.borrowStatus).toBe("checking");
    start();
    await act(() => retry!);

    expect(borrow.run).toHaveBeenCalledTimes(2);
    expect(reallocation.run).not.toHaveBeenCalled();
    expect(result.current.borrowStatus).toBe("success");
  });
});
