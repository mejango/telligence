import { BorrowDialog } from "@/app/[slug]/components/Value/BorrowDialog";
import { BridgeDialog } from "@/app/[slug]/components/Value/BridgeDialog";
import { ReallocateDialog } from "@/app/[slug]/components/Value/ReallocateDialog";
import { RedeemDialog } from "@/app/[slug]/components/Value/RedeemDialog";
import { RepayDialog } from "@/app/[slug]/components/Value/RepayDialog";
import { netLoanProceeds } from "@/lib/feeHelpers";
import { repayCeilingFor } from "@/lib/loanFees";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import { NATIVE_TOKEN, type JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { formatUnits, pad, parseAbi, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cash out, bridge, borrow, refinance and repay each host their confirm in
// their own dialog, whose owner resets and closes it on any request. While a
// send is in flight, from Confirm through the reads that precede the wallet
// prompt, the confirm must hold that dialog: before the hold, Escape, a
// backdrop press or the × dropped the run's only view while it kept going, and
// the next open could send again.

const mocks = vi.hoisted(() => ({
  /** The selected chain reclaims USDC while the page's chain holds ETH. */
  usdcReclaim: false,
  /** The index has not answered yet. */
  indexLoading: false,
  /** What the selected chain's terminal states as its accounting contexts; null is a failed read. */
  onchainContexts: null as { token: string; decimals: number; currency: number }[] | null,
  /** The connected wallet, or undefined for a visitor with none. */
  account: "0x1111111111111111111111111111111111111111" as string | undefined,
  /** The registry's active pairs from the home chain, when a test overrides them. */
  homePairs: null as { local: string; remote: string; remoteChainId: bigint }[] | null,
  /** What the loans contract quotes for the entered collateral. */
  borrowQuote: (10n ** 18n) as bigint | undefined,
  borrowQuoteError: false,
  routeHolder: vi.fn(),
  bridgeBeneficiary: vi.fn(),
  /** The balance rows' chain/project pairs; null = the default home and peer rows. */
  balanceRows: null as [number, number][] | null,
  verifiedPairs: [] as { peerChainId: number; projectId: bigint }[],
  write: vi.fn(),
  prepareCashOut: vi.fn(),
  freshBorrowable: vi.fn(),
  hasPermissions: vi.fn(),
  toast: vi.fn(),
  verifyDestinationMint: vi.fn(),
  beforeReverify: vi.fn(),
  /**
   * The hash each of a flow's write hooks sent last, as the hook reports it, in
   * the order the flow mounts its hooks (cash out: its sale, then its approval).
   */
  sent: [] as (`0x${string}` | undefined)[],
  /** How many write hooks have mounted, which picks each one's entry in `sent`. */
  writeHooks: 0,
  /** Whether the loan's base token is native, so repay skips its allowance read. */
  nativeBase: true,
  /**
   * When set, the allowance is enough on chain 1 (the loan's) and nothing on the
   * client usePublicClient returns without a chain (the wallet's).
   */
  allowanceOnLoanChainOnly: false,
  /** The bridge's token allowance is already enough, so the move is one call. */
  bridgeAllowed: false,
  /** A pool sale beats cashing out, and the claimed tokens cover it. */
  directSell: false,
  /** A write goes to the Safe as a proposal, which reads as loading until it executes. */
  safeProposal: false,
  /** That proposal's result can't be confirmed here. */
  safeUnconfirmed: false,
  /** The Safe runs the proposed step later, which core reports as done. */
  safeLands: false,
  /** The chain whose node has a sent hash's receipt; no other chain's node has it. */
  receiptOn: null as number | null,
  /** Whether that receipt shows a revert. */
  reverted: false,
  /** A sent hash's receipt never lands: an unbounded watch waits forever, a bounded one ends. */
  neverLands: false,
  /** The loans contract's terminal accounting context for the loan token, read onchain. */
  loanContext: {
    token: "0x000000000000000000000000000000000000EEEe",
    decimals: 18,
    currency: 61166,
  } as { token: string; decimals: number; currency: number },
  /** The onchain loan token read fails. */
  loanSourceFails: false,
  clients: {} as Record<number, unknown>,
  loan: { amount: 10n ** 18n, collateral: 2n * 10n ** 18n },
}));

const tokenBalance = (chainId: number, projectId: number) => ({
  chainId,
  projectId,
  balance: { value: 5n * 10n ** 18n, format: () => "5" },
});

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: mocks.account }),
  useConfig: () => ({}),
  // One client per chain across renders, as wagmi's is.
  usePublicClient: (parameters?: { chainId?: number }) =>
    (mocks.clients[parameters?.chainId ?? 0] ??= {
      getChainId: async () => parameters?.chainId ?? 1,
      waitForTransactionReceipt: async () => ({ status: "success" }),
      readContract: async ({ functionName }: { functionName?: string }) => {
        if (functionName === "suckerPairsOf") {
          if (parameters?.chainId === 10) {
            return [
              {
                local: "0x4444444444444444444444444444444444444444",
                remote: pad("0x3333333333333333333333333333333333333333"),
                remoteChainId: 1n,
              },
            ];
          }
          return (
            mocks.homePairs ?? [
              {
                local: "0x3333333333333333333333333333333333333333",
                remote: pad("0x4444444444444444444444444444444444444444"),
                remoteChainId: 10n,
              },
            ]
          );
        }
        if (functionName === "projectId") return 8n;
        if (functionName === "allowance" && mocks.bridgeAllowed) return 10n ** 30n;
        if (functionName === "TERMINAL") {
          if (mocks.loanSourceFails) throw new Error("The node can't be reached.");
          return "0x5555555555555555555555555555555555555555";
        }
        if (functionName === "accountingContextsOf") return [mocks.loanContext];
        if (functionName === "accountingContextForTokenOf") return mocks.loanContext;
        if (functionName === "revnetIdOfLoanWith") return 7n;
        if (functionName === "loanOf") {
          return {
            amount: 10n ** 18n,
            collateral: 2n * 10n ** 18n,
            sourceToken: mocks.loanContext.token,
          };
        }
        return mocks.directSell && functionName === "balanceOf"
          ? 5n * 10n ** 18n
          : mocks.allowanceOnLoanChainOnly && parameters?.chainId === 1
            ? 10n ** 30n
            : 0n;
      },
    }),
  useWalletClient: () => ({ data: {} }),
  useSimulateContract: () => ({ isLoading: false, error: null }),
  // The chain's own receipt read, which a Safe proposal never makes. A sent
  // hash's receipt is only on `receiptOn`'s node; a bounded watch of one that
  // never lands ends at its timeout.
  useWaitForTransactionReceipt: ({
    hash,
    chainId,
    timeout,
    query,
  }: {
    hash?: string;
    chainId?: number;
    timeout?: number;
    query?: { enabled?: boolean };
  }) => {
    const idle = {
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      isSuccess: false,
    };
    if (!hash || query?.enabled === false) return idle;
    if (chainId === mocks.receiptOn) {
      const status = mocks.reverted ? "reverted" : "success";
      return { ...idle, isSuccess: true, data: { status, transactionHash: hash } };
    }
    if (mocks.neverLands && typeof timeout === "number") {
      const error = Object.assign(new Error("Timed out while waiting for transaction."), {
        name: "WaitForTransactionReceiptTimeoutError",
      });
      return { ...idle, isError: true, error };
    }
    return { ...idle, isLoading: true };
  },
  useReadContract: ({ functionName }: { functionName?: string }) => {
    // One object across renders, as wagmi's structurally shared data is.
    const loan = mocks.loan;
    const answers: Record<string, unknown> = {
      PERMISSIONS: "0x4444444444444444444444444444444444444444",
      suckerPairsOf: mocks.homePairs ?? [
        {
          local: "0x3333333333333333333333333333333333333333",
          remote: pad("0x4444444444444444444444444444444444444444"),
          remoteChainId: 10n,
        },
      ],
      loanOf: loan,
      determineSourceFeeAmount: 1_000n,
      borrowableAmountFrom: [0n, 5n * 10n ** 17n],
    };
    return { data: functionName ? answers[functionName] : undefined, isLoading: false };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/cache", () => ({ revalidateCacheTag: async () => undefined }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    variant: _variant,
    size: _size,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
    variant?: string;
    size?: string;
  }) => (
    // A loading button shows a spinner: aria-busy stands in for it.
    <button {...props} aria-busy={_loading || undefined}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/app/[slug]/components/Value/SimulatedLoanCard", () => ({
  SimulatedLoanCard: () => null,
}));
vi.mock("@/components/ui/use-toast", () => ({
  toast: mocks.toast,
  useToast: () => ({ toast: mocks.toast }),
}));
/**
 * Core's run as these flows see it, phase by phase: each call's live checks, then `write` as the
 * wallet, then its receipt on the chain it was sent on (`receiptOn`'s node only; elsewhere it
 * never lands, or, with `neverLands`, the run ends unconfirmed). A Safe connection's send is a
 * proposal; with `safeUnconfirmed` its result can't be confirmed.
 */
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { useState } = await import("react");
  const { reviewedRunStatus } = await import("@bananapus/nana-sdk-core/review/machines");
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: () => {
      const [state, setState] = useState<{ phase: string; held: { exit: object } | null }>({
        phase: "idle",
        held: null,
      });
      const run = async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
        const hashes: Hex[] = [];
        for (const [step, call] of action.calls.entries()) {
          const variables = { ...call, address: call.to, account: action.account };
          await mocks.beforeReverify(variables);
          try {
            await action.reverify?.(call, step, undefined);
          } catch (failure) {
            return { status: "failed", error: (failure as Error).message, failure };
          }
          setState({ phase: "signing", held: null });
          let hash: Hex;
          try {
            hash = await mocks.write(variables);
          } catch (failure) {
            setState({ phase: "idle", held: null });
            return { status: "failed", error: (failure as Error).message, failure };
          }
          await action.onSubmitted?.(call, step, hash, {
            safe: mocks.safeProposal,
            adopted: false,
          });
          if (mocks.safeProposal) {
            setState({ phase: "proposed", held: mocks.safeUnconfirmed ? { exit: {} } : null });
            if (mocks.safeLands) setTimeout(() => setState({ phase: "done", held: null }), 0);
            return { status: "proposed", step, safeTxHash: hash };
          }
          setState({ phase: "receipt", held: null });
          if (call.chainId !== mocks.receiptOn) {
            if (!mocks.neverLands) await never();
            setState({ phase: "idle", held: null });
            return {
              status: "failed",
              error: "Couldn't confirm this yet. Check your wallet before sending again.",
              failure: new Error("unconfirmed"),
            };
          }
          if (mocks.reverted) {
            setState({ phase: "idle", held: null });
            return {
              status: "failed",
              error: "The transaction reverted onchain. Nothing changed.",
              failure: new Error("reverted"),
            };
          }
          hashes.push(hash);
        }
        setState({ phase: "done", held: null });
        return { status: "done", hashes, receipts: [] };
      };
      return {
        ...state,
        ...reviewedRunStatus({
          phase: state.phase as Parameters<typeof reviewedRunStatus>[0]["phase"],
          error: null,
          settled: null,
          held: state.held as Parameters<typeof reviewedRunStatus>[0]["held"],
        }),
        run,
        error: null,
        reset: () => setState({ phase: "idle", held: null }),
      };
    },
  };
});
vi.mock("@/hooks/useProjectBaseToken", () => ({
  useProjectBaseToken: () => ({ symbol: "ETH", decimals: 18, tokenMap: {} }),
}));
vi.mock("@/hooks/useBorrowableAmountFrom", () => ({
  useBorrowableAmountFrom: () => ({
    data: mocks.borrowQuote,
    capacity: 2n * 10n ** 18n,
    isError: mocks.borrowQuoteError,
  }),
}));
vi.mock("@/hooks/useCashOutRoute", () => {
  const data = {
    expectedReturn: 10n ** 17n,
    minimumReturn: 9n * 10n ** 16n,
    route: "treasury",
    treasuryProtocolFee: 25n * 10n ** 14n,
  };
  return {
    useCashOutRoute: ({ holder }: { holder?: string }) => {
      mocks.routeHolder(holder);
      return {
        // The real query is off without a holder.
        data: holder ? data : undefined,
        isFetching: false,
        isError: false,
        refetch: async () => ({ data, isError: false }),
      };
    },
  };
});
vi.mock("@/lib/directSellSwap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/directSellSwap")>()),
  quoteDirectSellSwap: async () =>
    mocks.directSell
      ? { poolKey: {}, zeroForOne: true, quotedOutput: 2n * 10n ** 17n, minimumOutput: 10n ** 17n }
      : null,
  buildDirectSellSwapTx: ({ chainId }: { chainId: number }) => ({
    chainId,
    address: "0x6666666666666666666666666666666666666666",
    abi: [
      {
        type: "function",
        name: "execute",
        stateMutability: "payable",
        inputs: [{ name: "deadline", type: "uint256" }],
        outputs: [],
      },
    ],
    functionName: "execute",
    args: [0n],
    value: 0n,
  }),
}));
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/owners/market/lib")>()),
  readPoolSnapshot: async () => ({ pool: mocks.directSell ? { key: {} } : null }),
}));
vi.mock("@/lib/cashOutQuote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cashOutQuote")>()),
  cashOutPoolBufferBps: () => null,
}));
vi.mock("@/lib/bendystraw", () => ({
  ProjectOperation: { id: "Project" },
  SuckerGroupOperation: { id: "SuckerGroup" },
  useBendystrawQuery: () => ({ data: undefined, isLoading: mocks.indexLoading }),
}));
vi.mock("@/lib/nana/project", () => ({
  useChain: () => undefined,
  useJBChainId: () => 1,
  useJBContractContext: () => ({
    contractAddress: () => "0x5555555555555555555555555555555555555555",
  }),
  useJBTokenContext: () => ({ token: { data: { decimals: 18, symbol: "REV" } } }),
}));
vi.mock("@/lib/nana/suckers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nana/suckers")>()),
  useSuckers: () => ({
    data: [{ peerChainId: 1, projectId: 7n }],
    verifiedPairs: mocks.verifiedPairs,
    isVerified: true,
    isError: false,
  }),
  useSuckersUserTokenBalance: () => ({
    data: (
      mocks.balanceRows ?? [
        [1, 7],
        [10, 8],
      ]
    ).map(([chainId, projectId]) => tokenBalance(chainId, projectId)),
    isLoading: false,
  }),
}));
vi.mock("@/lib/tokenUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tokenUtils")>()),
  getTokenConfigForChain: () =>
    mocks.usdcReclaim
      ? { token: "0x00000000000000000000000000000000000000Cc", decimals: 6, currency: 3 }
      : {
          token: "0x000000000000000000000000000000000000EEEe",
          decimals: 18,
          currency: 61166,
          symbol: "ETH",
        },
  getTokenSymbolFromAddress: () => (mocks.usdcReclaim ? "USDC" : "ETH"),
  isNativeToken: () => mocks.nativeBase,
}));
vi.mock("@/lib/token", () => ({
  getTokenAddress: async () => "0x2222222222222222222222222222222222222222",
}));
vi.mock("@/lib/bridgePrepare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bridgePrepare")>()),
  quoteBridgePrepare: async (_client: unknown, { beneficiary }: { beneficiary: string }) => {
    mocks.bridgeBeneficiary(beneficiary);
    return {
      netReclaimAmount: 10n ** 17n,
      minTokensReclaimed: 9n * 10n ** 16n,
      tokenDecimals: 18,
    };
  },
}));
vi.mock("@/lib/loanTransactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/loanTransactions")>()),
  readFreshBorrowableAmount: mocks.freshBorrowable,
}));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getAccountingContexts: async () => {
    if (!mocks.onchainContexts) throw new Error("unreadable");
    return mocks.onchainContexts;
  },
  getTokenAddress: async () => "0x2222222222222222222222222222222222222222",
  hasPermissions: mocks.hasPermissions,
  prepareHookAwareCashOut: mocks.prepareCashOut,
  verifySuckerDestinationMint: mocks.verifyDestinationMint,
}));

/** A read or wallet prompt that has not answered yet. */
const never = () => new Promise<never>(() => undefined);

function renderWithQueries(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

const dialogNamed = (name: string) => screen.getByRole("dialog", { name }) as HTMLDialogElement;
const confirmPanel = async () => {
  await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).not.toBeNull());
  return document.querySelector<HTMLElement>("[data-tx-confirm]")!;
};
const hostClose = (dialog: HTMLDialogElement) =>
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => !button.closest("[data-tx-confirm]") && button.textContent === "Close",
  )!;

/** Every way out of the dialog while the send is in flight; none may close it. */
function tryEveryWayOut(name: string) {
  const dialog = dialogNamed(name);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.pointerDown(dialog);
  fireEvent.click(hostClose(dialog));
  expect(dialog.open).toBe(true);
  expect(dialogNamed(name)).toBe(dialog);
  expect(document.querySelector("[data-tx-confirm]")).not.toBeNull();
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.sent = [];
  mocks.writeHooks = 0;
  mocks.nativeBase = true;
  mocks.usdcReclaim = false;
  mocks.indexLoading = false;
  mocks.onchainContexts = null;
  mocks.allowanceOnLoanChainOnly = false;
  mocks.bridgeAllowed = false;
  mocks.directSell = false;
  mocks.safeProposal = false;
  mocks.safeUnconfirmed = false;
  mocks.safeLands = false;
  mocks.receiptOn = null;
  mocks.neverLands = false;
  mocks.reverted = false;
  mocks.loanContext = {
    token: "0x000000000000000000000000000000000000EEEe",
    decimals: 18,
    currency: 61166,
  };
  mocks.loanSourceFails = false;
  mocks.verifiedPairs = [
    { peerChainId: 1, projectId: 7n },
    { peerChainId: 10, projectId: 8n },
  ];
  mocks.balanceRows = null;
  mocks.write.mockReset().mockImplementation(never);
  mocks.prepareCashOut.mockReset().mockImplementation(never);
  mocks.freshBorrowable.mockReset().mockImplementation(never);
  mocks.hasPermissions.mockReset().mockResolvedValue(true);
  mocks.verifyDestinationMint.mockReset().mockResolvedValue(undefined);
  mocks.beforeReverify.mockReset().mockResolvedValue(undefined);
});

/** Each flow, opened as the app opens it, run up to its confirm's action. */
async function confirmCashOut() {
  renderWithQueries(
    <RedeemDialog projectId={7n} tokenSymbol="REV">
      <button type="button">Open cash out</button>
    </RedeemDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
  fireEvent.click(await screen.findByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: /Ethereum/ }));
  fireEvent.change(screen.getByLabelText("Tokens to cash out"), { target: { value: "1" } });
  // Enabled once the chain's terminal has answered for its token.
  const cashOut = screen.getByRole("button", { name: "Cash out" });
  await waitFor(() => expect(cashOut).toBeEnabled());
  fireEvent.click(cashOut);
  await confirmPanel();
}

async function confirmBridge() {
  mocks.bridgeAllowed = true;
  renderWithQueries(
    <BridgeDialog
      projects={[
        { projectId: 7, chainId: 1, token: NATIVE_TOKEN },
        { projectId: 8, chainId: 10, token: NATIVE_TOKEN },
      ]}
    >
      <button type="button">Open move</button>
    </BridgeDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open move" }));
  const [, to] = await screen.findAllByRole("combobox");
  fireEvent.click(to);
  fireEvent.click(await screen.findByRole("option", { name: /Optimism/ }));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
  const move = screen.getByRole("button", { name: "Move REV" });
  await waitFor(() => expect(move).toBeEnabled());
  fireEvent.click(move);
  await confirmPanel();
}

describe("bridge destination mint readiness at the wallet boundary", () => {
  it("refuses source submission when mint authority is lost during transaction review", async () => {
    mocks.beforeReverify.mockImplementation(async () => {
      mocks.verifyDestinationMint.mockRejectedValue(new Error("Destination mint denied"));
    });

    await confirmBridge();

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Destination mint denied",
        }),
      ),
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("probes the exact destination peer, project, beneficiary and reviewed count before writing", async () => {
    await confirmBridge();

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.verifyDestinationMint).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      chainId: 10,
      projectId: 8n,
      sucker: "0x4444444444444444444444444444444444444444",
      beneficiary: "0x1111111111111111111111111111111111111111",
      tokenCount: 10n ** 18n,
    });
    expect(mocks.verifyDestinationMint.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.write.mock.invocationCallOrder[0],
    );
  });
});

async function confirmBorrow() {
  renderWithQueries(
    <BorrowDialog projectId={7n} tokenSymbol="REV">
      <button type="button">Open borrow</button>
    </BorrowDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open borrow" }));
  fireEvent.change(await screen.findByLabelText(/How much REV/), { target: { value: "1" } });
  const open = screen.getByRole("button", { name: "Open loan" });
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
  await confirmPanel();
}

describe("a loan's source token, decimals and currency", () => {
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  it("wallet-action:loans quotes and sends in the loans contract's onchain context, with one confirmation", async () => {
    // The indexer says ETH/18; the revnet's terminal accounts for USDC/6 on this chain.
    mocks.loanContext = { token: USDC, decimals: 6, currency: 909516616 };
    mocks.freshBorrowable.mockResolvedValue(10n ** 6n);
    // The wallet prompt stays open, so the one confirm that led to it is still on screen.
    await confirmBorrow();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.freshBorrowable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ revnetId: 7n, decimals: 6n, currency: 909516616n }),
    );
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ functionName: "borrowFrom" });
    expect(mocks.write.mock.calls[0][0].args[1]).toBe(USDC);
    expect(document.querySelectorAll("[data-tx-confirm]")).toHaveLength(1);
  });

  it("wallet-action:loans keeps Open loan off with one line when the loan token can't be read", async () => {
    mocks.loanSourceFails = true;
    renderWithQueries(
      <BorrowDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open borrow</button>
      </BorrowDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open borrow" }));
    fireEvent.change(await screen.findByLabelText(/How much REV/), { target: { value: "1" } });
    expect(
      await screen.findByText("Couldn't read this network's loan token onchain. Try again."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open loan" })).toBeDisabled();
    expect(mocks.freshBorrowable).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("wallet-action:loans sends nothing and shows the same line when the send-time read fails", async () => {
    renderWithQueries(
      <BorrowDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open borrow</button>
      </BorrowDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open borrow" }));
    fireEvent.change(await screen.findByLabelText(/How much REV/), { target: { value: "1" } });
    const open = screen.getByRole("button", { name: "Open loan" });
    await waitFor(() => expect(open).toBeEnabled());
    // The read at send fails.
    mocks.loanSourceFails = true;
    fireEvent.click(open);
    await confirmPanel();
    expect(
      await screen.findByText("Couldn't read this network's loan token onchain. Try again."),
    ).toBeTruthy();
    expect(mocks.freshBorrowable).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-tx-confirm]").length).toBeLessThanOrEqual(1);
  });

  it("wallet-action:loans sends nothing when the loan token changes after review, and says so in place", async () => {
    renderWithQueries(
      <BorrowDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open borrow</button>
      </BorrowDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open borrow" }));
    fireEvent.change(await screen.findByLabelText(/How much REV/), { target: { value: "1" } });
    const open = screen.getByRole("button", { name: "Open loan" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    mocks.loanContext = { token: USDC, decimals: 6, currency: 909516616 };
    await confirmPanel();
    expect(
      await screen.findByText(
        "This network's loan token changed. Check the terms and confirm again.",
      ),
    ).toBeTruthy();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-tx-confirm]")).toHaveLength(1);
  });
});

async function confirmRefinance() {
  renderWithQueries(
    <ReallocateDialog projectId={7n} tokenSymbol="REV" selectedLoan={LOAN}>
      <button type="button">Open refinance</button>
    </ReallocateDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open refinance" }));
  const refinance = await screen.findByRole("button", { name: "Refinance loan" });
  await waitFor(() => expect(refinance).toBeEnabled());
  fireEvent.click(refinance);
  await confirmPanel();
}

async function confirmRepay() {
  function Loans() {
    const [open, setOpen] = useState(true);
    return (
      <RepayDialog
        loanId="3"
        chainId={1 as JBChainId}
        projectId={7n}
        loanProjectId={7n}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }
  renderWithQueries(<Loans />);
  const repay = await screen.findByRole("button", { name: "Repay loan" });
  await waitFor(() => expect(repay).toBeEnabled());
  fireEvent.click(repay);
  await confirmPanel();
}

describe("a repayment's loan token, decimals and currency", () => {
  function openRepay() {
    function Loans() {
      const [open, setOpen] = useState(true);
      return (
        <RepayDialog
          loanId="3"
          chainId={1 as JBChainId}
          projectId={7n}
          loanProjectId={7n}
          open={open}
          onOpenChange={setOpen}
        />
      );
    }
    renderWithQueries(<Loans />);
  }

  it("wallet-action:repay authorizes in the loans contract's onchain decimals, with one confirmation", async () => {
    // The indexer says ETH/18; the loans contract prices this loan in a 6-decimal context.
    mocks.loanContext = { ...mocks.loanContext, decimals: 6 };
    await confirmRepay();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const ceiling = repayCeilingFor(10n ** 18n - 5n * 10n ** 17n, 1_000n);
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ functionName: "repayLoan" });
    expect(screen.getByText(`${formatUnits(ceiling, 6)} ETH`, { exact: false })).toBeTruthy();
    expect(document.querySelectorAll("[data-tx-confirm]")).toHaveLength(1);
  });

  it("wallet-action:repay shows one line and no repay button when the loan token can't be read", async () => {
    mocks.loanSourceFails = true;
    openRepay();
    expect(
      await screen.findByText("Couldn't read this network's loan token onchain. Try again."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Repay loan" })).toBeNull();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("wallet-action:repay sends nothing when the send-time read fails, and says so in place", async () => {
    openRepay();
    const repay = await screen.findByRole("button", { name: "Repay loan" });
    await waitFor(() => expect(repay).toBeEnabled());
    mocks.loanSourceFails = true;
    fireEvent.click(repay);
    const confirm = await confirmPanel();
    expect(
      await within(confirm).findByText(
        "Couldn't read this network's loan token onchain. Try again.",
      ),
    ).toBeTruthy();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("what a confirm says about fees", () => {
  it("names the fee already taken out of a cash out from the revnet's funds", async () => {
    await confirmCashOut();
    const confirm = document.querySelector("[data-tx-confirm]")!;
    expect(confirm.textContent).toMatch(/Fee\s*0\.0025 /);
  });

  it("states cash out amounts in the selected chain's token, not the page's", async () => {
    mocks.usdcReclaim = true;
    mocks.nativeBase = false;
    await confirmCashOut();
    const confirm = document.querySelector("[data-tx-confirm]")!;
    // 2_500_000_000_000_000 raw at 6 decimals; at the page's 18 it read 0.0025 ETH.
    expect(confirm.textContent).toMatch(/Fee\s*2,?500,?000,?000 USDC/);
    expect(confirm.textContent).not.toContain("ETH");
  });

  it("takes the cash out token from the chain's terminal over the index", async () => {
    // The index says ETH; the terminal says a 6 decimal token.
    mocks.nativeBase = false;
    mocks.onchainContexts = [
      { token: "0x00000000000000000000000000000000000000Cc", decimals: 6, currency: 3 },
    ];
    await confirmCashOut();
    const confirm = document.querySelector("[data-tx-confirm]")!;
    expect(confirm.textContent).toMatch(/Fee\s*2,?500,?000,?000 /);
    expect(mocks.prepareCashOut.mock.calls.at(-1)?.[1]).toMatchObject({
      tokenToReclaim: "0x00000000000000000000000000000000000000Cc",
    });
  });

  it("opens no review while the index that picks among the terminal's tokens is still loading", async () => {
    mocks.indexLoading = true;
    mocks.onchainContexts = [
      { token: "0x000000000000000000000000000000000000EEEe", decimals: 18, currency: 61166 },
      { token: "0x00000000000000000000000000000000000000Cc", decimals: 6, currency: 3 },
    ];
    renderWithQueries(
      <RedeemDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open cash out</button>
      </RedeemDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
    fireEvent.click(await screen.findByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /Ethereum/ }));
    fireEvent.change(screen.getByLabelText("Tokens to cash out"), { target: { value: "1" } });
    // The terminal has answered; the first context alone is not the answer.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("button", { name: "Cash out" })).toBeDisabled();
  });

  it("keeps an open review on the token it opened with when the index answers differently later", async () => {
    // The terminal lists two tokens; the index, failed for now, cannot pick, so the first stands.
    mocks.onchainContexts = [
      { token: "0x000000000000000000000000000000000000EEEe", decimals: 18, currency: 61166 },
      { token: "0x00000000000000000000000000000000000000Cc", decimals: 6, currency: 3 },
    ];
    const client = new QueryClient();
    const ui = () => (
      <QueryClientProvider client={client}>
        <RedeemDialog projectId={7n} tokenSymbol="REV">
          <button type="button">Open cash out</button>
        </RedeemDialog>
      </QueryClientProvider>
    );
    const view = render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
    fireEvent.click(await screen.findByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /Ethereum/ }));
    fireEvent.change(screen.getByLabelText("Tokens to cash out"), { target: { value: "1" } });
    const cashOut = screen.getByRole("button", { name: "Cash out" });
    await waitFor(() => expect(cashOut).toBeEnabled());
    fireEvent.click(cashOut);
    const confirm = await confirmPanel();
    expect(confirm.textContent).toMatch(/Fee\s*0\.0025 ETH/);

    // The index recovers and names the other token.
    mocks.usdcReclaim = true;
    view.rerender(ui());
    expect((await confirmPanel()).textContent).toMatch(/Fee\s*0\.0025 ETH/);
    expect((await confirmPanel()).textContent).not.toContain("USDC");
  });

  it("names a loan's fees and what reaches the borrower after them", async () => {
    await confirmBorrow();
    const confirm = document.querySelector("[data-tx-confirm]")!;
    expect(confirm.textContent).toContain("2.5% protocol + 1% revnet + 2.5% prepaid");
    // The 1 token quote less the three fees, by the contracts' own arithmetic.
    expect(confirm.textContent).toContain(
      `You receive~${formatUnits(netLoanProceeds(10n ** 18n, 25n), 18)} `,
    );
  });
});

describe("cash out's reviewed minimum", () => {
  it("sends nothing when the fresh minimum is below the one the review shows", async () => {
    mocks.prepareCashOut.mockResolvedValue({
      route: { expectedReturn: 10n ** 17n, minimumReturn: 8n * 10n ** 16n },
      transaction: {
        chainId: 1,
        address: "0x6666666666666666666666666666666666666666",
        abi: parseAbi(["function cashOutTokensOf()"]),
        functionName: "cashOutTokensOf",
        args: [],
      },
    });
    await confirmCashOut();
    expect(
      (await screen.findAllByText("The cash out estimate dropped. Review the new estimate."))
        .length,
    ).toBeGreaterThan(0);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("value flows hold their dialog while a send is in flight", () => {
  it("cash out, from Confirm through the route read before the wallet prompt", async () => {
    await confirmCashOut();
    await waitFor(() => expect(mocks.prepareCashOut).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Cash out");
  });

  it("bridge", async () => {
    await confirmBridge();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Move between networks");
  });

  it("borrow, from Confirm through the fresh quote read before the wallet prompt", async () => {
    await confirmBorrow();
    await waitFor(() => expect(mocks.freshBorrowable).toHaveBeenCalledTimes(1));
    tryEveryWayOut("New loan");
  });

  it("refinance, from Confirm through the fresh quote read before the wallet prompt", async () => {
    await confirmRefinance();
    await waitFor(() => expect(mocks.freshBorrowable).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Refinance loan");
  });

  it("wallet-action:repay repay", async () => {
    await confirmRepay();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Repay loan");
  });
});

/** Opens a market sale on Ethereum and presses its confirm's token approval. */
async function approveSale() {
  mocks.directSell = true;
  mocks.write.mockResolvedValue(`0x${"cd".repeat(32)}`);
  renderWithQueries(
    <RedeemDialog projectId={7n} tokenSymbol="REV">
      <button type="button">Open cash out</button>
    </RedeemDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
  fireEvent.click(await screen.findByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: /Ethereum/ }));
  fireEvent.change(screen.getByLabelText("Tokens to cash out"), { target: { value: "1" } });
  const sell = await screen.findByRole("button", { name: "Sell on market" });
  await waitFor(() => expect(sell).toBeEnabled());
  fireEvent.click(sell);
  const confirm = await confirmPanel();
  await waitFor(() => expect(mocks.write).toHaveBeenCalled());
  expect(mocks.write.mock.calls[0]![0]).toMatchObject({ functionName: "approve", chainId: 1 });
  return confirm;
}

describe("cash out's sucker pair", () => {
  it("wallet-action:cash-out stays off for a pair the on-chain sucker registry does not list", async () => {
    mocks.verifiedPairs = [{ peerChainId: 1, projectId: 9n }];
    renderWithQueries(
      <RedeemDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open cash out</button>
      </RedeemDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
    fireEvent.click(await screen.findByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /Ethereum/ }));
    fireEvent.change(screen.getByLabelText("Tokens to cash out"), { target: { value: "1" } });
    expect(
      await screen.findByText("The Ethereum project listed here isn't linked onchain."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cash out" })).toBeDisabled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("bridge's source and destination projects", () => {
  it("wallet-action:bridge stays off for a destination the on-chain sucker registry does not list", async () => {
    mocks.verifiedPairs = [{ peerChainId: 1, projectId: 7n }];
    renderWithQueries(
      <BridgeDialog
        projects={[
          { projectId: 7, chainId: 1, token: NATIVE_TOKEN },
          { projectId: 8, chainId: 10, token: NATIVE_TOKEN },
        ]}
      >
        <button type="button">Open move</button>
      </BridgeDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open move" }));
    const [, to] = await screen.findAllByRole("combobox");
    fireEvent.click(to);
    fireEvent.click(await screen.findByRole("option", { name: /Optimism/ }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    expect(
      await screen.findByText("The Optimism project listed here isn't linked onchain."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move REV" })).toBeDisabled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("cash out's reviewed chain", () => {
  it("stays reviewed when a verified peer's balance arrives after Cash out", async () => {
    // Only the home balance has loaded, so the home chain is chosen without a pick.
    mocks.balanceRows = [[1, 7]];
    const view = renderWithQueries(
      <RedeemDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open cash out</button>
      </RedeemDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
    fireEvent.change(await screen.findByLabelText("Tokens to cash out"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cash out" }));
    await confirmPanel();

    mocks.balanceRows = [
      [1, 7],
      [10, 8],
    ];
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <RedeemDialog projectId={7n} tokenSymbol="REV">
          <button type="button">Open cash out</button>
        </RedeemDialog>
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-tx-confirm]")).not.toBeNull();
  });
});

describe("cash out's sale approval", () => {
  it("says the approval couldn't be confirmed yet, sends nothing more, and offers Try again", async () => {
    mocks.neverLands = true;
    const confirm = await approveSale();

    await within(confirm).findByText(/Couldn't confirm this yet/);
    expect(within(confirm).getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("holds the progress until the approval's receipt lands", async () => {
    const confirm = await approveSale();

    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: "Close" })).toBeDisabled(),
    );
    tryEveryWayOut("Cash out");
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("wallet-action:cash-out continues to the sale in the same review once the approval's receipt lands on the cash-out chain", async () => {
    mocks.receiptOn = 1;
    await approveSale();

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(3));
    expect(mocks.write.mock.calls.map(([call]) => call.functionName)).toEqual([
      "approve",
      "approve",
      "execute",
    ]);
  });

  it("shows a reverted approval, and Close goes back with nothing more sent", async () => {
    mocks.receiptOn = 1;
    mocks.reverted = true;
    const confirm = await approveSale();

    await within(confirm).findByText(/reverted onchain/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(dialogNamed("Cash out").open).toBe(true);
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("closes on a Safe proposal and says to finish it in Safe", async () => {
    mocks.safeProposal = true;
    await approveSale();

    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "This proposal is waiting in your Safe. Finish it there first.",
      }),
    );
    expect(dialogNamed("Cash out").open).toBe(true);
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("returns to the sale, not its success, once the Safe runs only the approval", async () => {
    mocks.safeProposal = true;
    mocks.safeLands = true;
    await approveSale();

    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dialogNamed("Cash out")).not.toHaveTextContent("Success!");
    expect(screen.getByRole("button", { name: "Sell on market" })).toBeInTheDocument();
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("keeps the line on the form when the approval's Safe proposal can't be confirmed", async () => {
    mocks.safeProposal = true;
    mocks.safeUnconfirmed = true;
    await approveSale();

    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(dialogNamed("Cash out")).toHaveTextContent(
      "Check this proposal in your Safe before sending it again.",
    );
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});

// The confirm no longer switches the wallet before it sends, so a flow's reads
// must name the chain they are about rather than follow the wallet's.
const ERC20_LOAN_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("repay reads on the loan's chain", () => {
  it("checks the allowance on the loan's chain, whichever chain the wallet is on", async () => {
    mocks.nativeBase = false;
    mocks.loanContext = { token: ERC20_LOAN_TOKEN, decimals: 6, currency: 909516616 };
    mocks.allowanceOnLoanChainOnly = true;
    function Loans() {
      const [open, setOpen] = useState(true);
      return (
        <RepayDialog
          loanId="3"
          chainId={1 as JBChainId}
          projectId={7n}
          loanProjectId={7n}
          open={open}
          onOpenChange={setOpen}
        />
      );
    }
    renderWithQueries(<Loans />);

    const repay = await screen.findByRole("button", { name: "Repay loan" });
    await waitFor(() => expect(repay).toBeEnabled());
    expect(screen.queryByText("Token approval needed")).toBeNull();
  });
});

describe("an ERC-20 repayment after its approval", () => {
  it("wallet-action:repay checks the allowance again and offers the repayment", async () => {
    mocks.nativeBase = false;
    mocks.loanContext = { token: ERC20_LOAN_TOKEN, decimals: 6, currency: 909516616 };
    mocks.write.mockResolvedValue(`0x${"ef".repeat(32)}`);
    mocks.receiptOn = 1;
    function Loans() {
      const [open, setOpen] = useState(true);
      return (
        <RepayDialog
          loanId="3"
          chainId={1 as JBChainId}
          projectId={7n}
          loanProjectId={7n}
          open={open}
          onOpenChange={setOpen}
        />
      );
    }
    // The approval lands: the loan's chain now holds enough allowance.
    mocks.beforeReverify.mockImplementation(async () => {
      mocks.allowanceOnLoanChainOnly = true;
    });
    renderWithQueries(<Loans />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve ETH" }));
    const repay = await screen.findByRole("button", { name: "Repay loan" });
    await waitFor(() => expect(repay).toBeEnabled());
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});

// Each send pays out to the account that pressed Confirm (the cash out, the
// sale, the loan, the bridged tokens, the returned collateral), so each names
// it: the reviewed write refuses it from any other account, such as one the
// wallet switched to while an approval or a quote was still in flight.
describe("value sends name the account they pay", () => {
  it.each([
    ["cash out", confirmCashOut],
    ["bridge", confirmBridge],
    ["borrow", confirmBorrow],
    ["refinance", confirmRefinance],
    ["repay", confirmRepay],
  ])("%s", async (_, confirmFlow) => {
    mocks.prepareCashOut.mockResolvedValue({
      route: { expectedReturn: 10n ** 17n, minimumReturn: 9n * 10n ** 16n },
      transaction: {
        chainId: 1,
        address: "0x6666666666666666666666666666666666666666",
        abi: parseAbi(["function cashOutTokensOf()"]),
        functionName: "cashOutTokensOf",
        args: [],
      },
    });
    mocks.freshBorrowable.mockResolvedValue(10n ** 18n);
    await confirmFlow();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({
      account: "0x1111111111111111111111111111111111111111",
    });
  });
});

// A step core's write hold refuses (its identical Safe proposal may still run) shows the hold's own
// line, whichever flow it is.
describe("value flows refused by core's write hold", () => {
  const LINE = "Check this proposal in your Safe before sending it again.";

  it.each([
    ["borrow's permission step", confirmBorrow, false],
    ["borrow", confirmBorrow, true],
    ["refinance", confirmRefinance, true],
    ["repay", confirmRepay, true],
    ["cash out", confirmCashOut, true],
  ])("%s", async (_flow, confirmFlow, permitted) => {
    mocks.hasPermissions.mockResolvedValue(permitted);
    mocks.freshBorrowable.mockResolvedValue(10n ** 18n);
    mocks.prepareCashOut.mockResolvedValue({
      route: { expectedReturn: 10n ** 17n, minimumReturn: 9n * 10n ** 16n },
      transaction: {
        chainId: 1,
        address: "0x6666666666666666666666666666666666666666",
        abi: parseAbi(["function cashOutTokensOf()"]),
        functionName: "cashOutTokensOf",
        args: [],
      },
    });
    mocks.write.mockRejectedValue(new Error(LINE));

    await confirmFlow();

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: LINE })),
    );
  });
});

// The wallet may sit on another chain by the time a send confirms: each flow
// watches its receipt on the chain it sent on.
describe("value sends watch their receipt on the chain they sent on", () => {
  beforeEach(() => {
    mocks.write.mockResolvedValue(`0x${"cd".repeat(32)}`);
    mocks.freshBorrowable.mockResolvedValue(10n ** 18n);
    mocks.receiptOn = 1;
  });

  it("bridge", async () => {
    await confirmBridge();
    expect(await screen.findByText(/First step confirmed/)).toBeInTheDocument();
  });

  it("borrow", async () => {
    await confirmBorrow();
    expect(await screen.findByText("Loan opened.")).toBeInTheDocument();
  });

  it("refinance", async () => {
    await confirmRefinance();
    expect(await screen.findByText("Loan refinanced.")).toBeInTheDocument();
  });

  it("repay", async () => {
    await confirmRepay();
    const dialog = dialogNamed("Repay loan");
    await waitFor(() =>
      expect(within(dialog).queryByRole("button", { name: "Repay loan" })).toBeNull(),
    );
    expect(within(dialog).getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });
});

const LOAN = {
  id: "3",
  chainId: 1,
  borrowAmount: (10n ** 18n).toString(),
  collateral: (2n * 10n ** 18n).toString(),
  projectId: 7,
};

describe("holder dialogs tell why their button is off, and preview for the viewed account", () => {
  const WALLET = "0x1111111111111111111111111111111111111111";
  const VIEWED = "0x000000000000000000000000000000000000bEEF";
  const pairTo = (chainId: bigint, local: string) => ({
    local,
    remote: pad(local as Hex),
    remoteChainId: chainId,
  });

  beforeEach(() => {
    mocks.account = WALLET;
    mocks.homePairs = null;
    mocks.borrowQuote = 10n ** 18n;
    mocks.borrowQuoteError = false;
    mocks.routeHolder.mockClear();
    mocks.bridgeBeneficiary.mockClear();
    mocks.balanceRows = [[1, 7]];
    mocks.verifiedPairs = [{ peerChainId: 1, projectId: 7n }];
    clearViewAs();
  });
  afterEach(() => {
    mocks.account = WALLET;
    mocks.homePairs = null;
    mocks.borrowQuote = 10n ** 18n;
    mocks.borrowQuoteError = false;
    clearViewAs();
  });

  async function openCashOut() {
    renderWithQueries(
      <RedeemDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open cash out</button>
      </RedeemDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
    return screen.findByLabelText("Tokens to cash out");
  }

  async function openMove() {
    mocks.balanceRows = [
      [1, 7],
      [10, 8],
    ];
    renderWithQueries(
      <BridgeDialog
        projects={[
          { projectId: 7, chainId: 1, token: NATIVE_TOKEN },
          { projectId: 8, chainId: 10, token: NATIVE_TOKEN },
        ]}
      >
        <button type="button">Open move</button>
      </BridgeDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open move" }));
    const [, to] = await screen.findAllByRole("combobox");
    fireEvent.click(to);
  }

  it("quotes a cash out for the viewed holder with no wallet connected", async () => {
    mocks.account = undefined;
    setViewAs(VIEWED);
    const amount = await openCashOut();
    fireEvent.change(amount, { target: { value: "1" } });
    expect(await screen.findByText(/You'll get/)).toBeTruthy();
    expect(mocks.routeHolder).toHaveBeenLastCalledWith(VIEWED);
    // View as reads only: the send button is off and says how to get it back.
    const stop = await screen.findByRole("button", { name: "Exit View as to cash out" });
    expect((stop as HTMLButtonElement).disabled).toBe(true);
  });

  it("quotes a cash out for the connected wallet outside View as", async () => {
    const amount = await openCashOut();
    fireEvent.change(amount, { target: { value: "1" } });
    expect(await screen.findByText(/You'll get/)).toBeTruthy();
    expect(mocks.routeHolder).toHaveBeenLastCalledWith(WALLET);
  });

  it("keeps Cash out off with a reason until an amount is entered, and a junk amount is not a crash", async () => {
    const amount = await openCashOut();
    const button = screen.getByRole("button", { name: "Cash out" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Enter an amount.")).toBeTruthy();
    fireEvent.change(amount, { target: { value: "abc" } });
    expect(button).toBeDisabled();
    expect(screen.getByText("Enter an amount.")).toBeTruthy();
    fireEvent.change(amount, { target: { value: "99" } });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Not enough REV on Ethereum/)).toBeTruthy();
    fireEvent.change(amount, { target: { value: "1" } });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText("Enter an amount.")).toBeNull();
  });

  it("quotes a move for the viewed holder with no wallet connected", async () => {
    mocks.account = undefined;
    setViewAs(VIEWED);
    await openMove();
    fireEvent.click(await screen.findByRole("option", { name: /Optimism/ }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    expect(await screen.findByText("Estimated funding moved")).toBeTruthy();
    expect(mocks.bridgeBeneficiary).toHaveBeenLastCalledWith(VIEWED);
  });

  it("lists a destination reached by two active suckers once", async () => {
    mocks.homePairs = [
      pairTo(10n, "0x3333333333333333333333333333333333333333"),
      pairTo(10n, "0x6666666666666666666666666666666666666666"),
    ];
    await openMove();
    expect(await screen.findAllByRole("option", { name: /Optimism/ })).toHaveLength(1);
  });

  it("says a move is over the balance when that is what keeps it off", async () => {
    await openMove();
    fireEvent.click(await screen.findByRole("option", { name: /Optimism/ }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "99" } });
    expect(await screen.findByText("Not enough REV on Ethereum")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move REV" })).toBeDisabled();
  });

  it("says nothing can be borrowed when the loans contract quotes zero", async () => {
    mocks.borrowQuote = 0n;
    renderWithQueries(
      <BorrowDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open loan form</button>
      </BorrowDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open loan form" }));
    fireEvent.change(await screen.findByLabelText(/How much REV/), { target: { value: "1" } });
    expect(await screen.findByText("Nothing can be borrowed on Ethereum right now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open loan" })).toBeDisabled();
  });

  it("says the loan quote failed when the read fails", async () => {
    mocks.borrowQuote = undefined;
    mocks.borrowQuoteError = true;
    renderWithQueries(
      <BorrowDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open loan form</button>
      </BorrowDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open loan form" }));
    fireEvent.change(await screen.findByLabelText(/How much REV/), { target: { value: "1" } });
    expect(await screen.findByText("Couldn't read the loan quote. Try again.")).toBeTruthy();
  });

  it("names the refinance's network and the loan's own number", async () => {
    renderWithQueries(
      <ReallocateDialog
        projectId={7n}
        tokenSymbol="REV"
        selectedLoan={{ ...LOAN, id: "6000000000000000002", chainId: 1 }}
      >
        <button type="button">Open refinance</button>
      </ReallocateDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open refinance" }));
    const box = (await screen.findByText("Current loan")).parentElement!;
    expect(within(box).getByText("Ethereum")).toBeTruthy();
    expect(within(box).getByText("2")).toBeTruthy();
    expect(within(box).queryByText("6000000000000000002")).toBeNull();
  });
});
