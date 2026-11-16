import { V6PayCard } from "@/app/[slug]/components/v6/pay/V6PayCard";
import { ReviewRefusal } from "@/lib/reviewed-call";
import { REVIEWED_ENGINE_LOAD_LINE } from "@bananapus/nana-sdk-core/review";
import {
  PAY_SWAP_QUOTE_FAILED_MESSAGE,
  PaySwapQuoteFailedError,
} from "@bananapus/nana-sdk-core/v6";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A payment that fails says why, in the SDK's words. When the failure is a minimum shortfall, the
// payer can loosen the tolerance and review again, and the minimum reviewed is the one sent.

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const FIRST = "0x3333333333333333333333333333333333333333" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  config: { id: "pay-boundary-config", chains: [{ id: 1, name: "Ethereum" }] },
  account: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 1,
    connector: { id: "injected", name: "Injected" },
  },
  terminal: "0x3333333333333333333333333333333333333333",
  routeError: null as Error | null,
  // Core's simulation of the payment before the wallet, and every route resolution's arguments.
  cardSimulate: vi.fn(),
  /** Whether the sent payment's receipt says it reverted. */
  reverted: false,
  routeCalls: [] as { slippageBps?: bigint }[],
  quoteFailed: false,
  routingUnavailable: false,
  surfaceFetching: false,
  refetchSurface: vi.fn(),
  // The wallet's send.
  submit: vi.fn(),
  resetRunner: () => undefined as void,
  run: null as null | import("vitest").Mock,
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useConfig: () => mocks.config,
  useAccount: () => ({ address: mocks.account.address, isConnected: true }),
  usePublicClient: () => ({ readContract: async () => 0n }),
}));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { liveReviewedAction } = await import("./support/reviewed-action");
  const runner = liveReviewedAction(
    mocks.submit,
    (hash) =>
      mocks.reverted
        ? {
            phase: "failed",
            error: "The transaction reverted onchain.",
            failure: Object.assign(new Error("reverted"), {
              name: "ReviewedCallRevertedError",
              step: 0,
              hash,
            }),
          }
        : undefined,
    mocks.cardSimulate,
  );
  mocks.resetRunner = runner.reset;
  mocks.run = runner.run;
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: runner.hook,
  };
});
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/GetFunds", () => ({
  useOnRamp: () => ({ supported: false, buy: vi.fn() }),
}));
vi.mock("@/components/IpfsImage", () => ({ ImageWithFallback: () => null }));
vi.mock("@/hooks/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: new Map([["0x000000000000000000000000000000000000EEEe", 10n ** 20n]]),
    isLoading: false,
  }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
  useJBProjectMetadataContext: () => ({ metadata: { data: { payDisclosure: "No refunds." } } }),
}));
vi.mock("@/lib/nana/suckers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nana/suckers")>()),
  useSuckers: () => ({ data: [], verifiedPairs: [{ peerChainId: 1, projectId: 7n }] }),
}));
vi.mock("@/lib/paymentTerminal", () => ({
  resolveBestV6PayRoute: async (args: { slippageBps?: bigint }) => {
    mocks.routeCalls.push(args);
    if (mocks.routeError) throw mocks.routeError;
    // The SDK floors its 1,000-token quote by the tolerance, 1% by default.
    const bps = args.slippageBps ?? 100n;
    return {
      address: mocks.terminal,
      type: "multi",
      preview: { beneficiaryTokenCount: 10n ** 21n, reservedTokenCount: 0n },
      metadata: "0x5150",
      minReturnedTokens: (10n ** 21n * (10_000n - bps)) / 10_000n,
      quoteFailed: mocks.quoteFailed,
    };
  },
}));
vi.mock("@/providers/ParaAuthContext", () => ({
  useParaAuth: () => ({ requestSignIn: vi.fn() }),
}));
vi.mock("@/app/[slug]/components/PayCard/SelectedSuckerContext", () => ({
  useSelectedSucker: () => ({
    selectedSucker: { peerChainId: 1, projectId: 7n },
    setSelectedSucker: vi.fn(),
  }),
}));
vi.mock("@/app/[slug]/components/v6/ShopCartContext", () => ({
  useShopCart: () => ({ items: [], remove: vi.fn(), setQuantity: vi.fn() }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePayShop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/pay/usePayShop")>()),
  usePayShop: () => ({ data: undefined }),
  usePayShopCredits: () => ({ data: 0n, isLoading: false }),
  usePayShopRoutes: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePaySurface", () => {
  const surface = {
    tokens: [
      {
        token: "0x000000000000000000000000000000000000EEEe",
        decimals: 18,
        currency: 61166,
        symbol: "ETH",
        viaRouter: false,
      },
    ],
    rulesetStart: 0,
    pausePay: false,
    terminals: ["0x3333333333333333333333333333333333333333"],
  };
  return {
    usePaySurface: () => ({
      data: { ...surface, routingUnavailable: mocks.routingUnavailable },
      isError: false,
      isFetching: mocks.surfaceFetching,
      refetch: mocks.refetchSurface,
    }),
  };
});
vi.mock("@/app/[slug]/components/v6/pay/V6PayShopStrip", () => ({ V6PayShopStrip: () => null }));

const TOKEN = 10n ** 18n;

/** A simulation that reverts with the terminal's UnderMin(received, minimum). */
function underMin(received: bigint, minimum: bigint) {
  return Object.assign(new Error("Execution reverted."), {
    shortMessage: "Execution reverted.",
    data: `0x6b2bb382${encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [received, minimum],
    ).slice(2)}`,
  });
}

/** A simulation that reverts because the project takes no payments now. */
function notAccepting() {
  return Object.assign(new Error("Execution reverted."), {
    shortMessage: "Execution reverted.",
    data: `0x8dc14446${encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [7n, 1n],
    ).slice(2)}`,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  mocks.terminal = FIRST;
  mocks.routeError = null;
  mocks.routeCalls = [];
  mocks.quoteFailed = false;
  mocks.routingUnavailable = false;
  mocks.surfaceFetching = false;
  mocks.refetchSurface.mockReset().mockResolvedValue(undefined);
  mocks.cardSimulate.mockReset().mockResolvedValue({ request: {} });
  mocks.reverted = false;
  mocks.submit.mockReset().mockResolvedValue(HASH);
  mocks.resetRunner();
});

afterEach(() => cleanup());

/** Open the card's confirm on a ready 1 ETH payment, then press its Pay. */
async function payFromConfirm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <V6PayCard />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
  const pay = screen.getByRole("button", { name: "Pay" });
  await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
  fireEvent.click(pay);
  const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
  await within(confirm).findByText(/^990 /);
  return confirm;
}

describe("a failed payment's reason and a looser minimum", () => {
  it("keeps a verified payment usable while additional routes are checked and retried", async () => {
    mocks.routingUnavailable = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const card = (
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>
    );
    const view = render(card);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry routes" }));
    expect(mocks.refetchSurface).toHaveBeenCalledOnce();
    mocks.surfaceFetching = true;
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Checking routes…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled();
    mocks.surfaceFetching = false;
    mocks.routingUnavailable = false;
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/Some payment routes could not be checked/)).toBeNull();
    client.clear();
  });

  it("sends the SDK's minimum with its default tolerance when nothing fails", async () => {
    await payFromConfirm();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.routeCalls.every((call) => call.slippageBps === undefined)).toBe(true);
    // pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)
    const { args } = mocks.submit.mock.calls[0]![0] as { args: unknown[] };
    expect(args[3]).toBe(ACCOUNT);
    expect(args[4]).toBe(990n * TOKEN);
  });

  it("shows a shortfall's reason, offers a looser tolerance, and sends the minimum reviewed again", async () => {
    mocks.cardSimulate.mockRejectedValueOnce(underMin(970n * TOKEN, 990n * TOKEN));
    const confirm = await payFromConfirm();

    await within(confirm).findByText(
      "This payment would get fewer tokens than your minimum, so lower your minimum or try again.",
    );
    // 20 short of 990 is 2.03%; on top of the 1% it was floored by, rounded up to a half percent.
    const field = within(confirm).getByLabelText(/Custom allowed decrease/);
    expect(field).toHaveValue(3.5);
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "4" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Review again" }));

    // The review shows the new minimum before anything is sent.
    await within(confirm).findByText(/^960 /);
    expect(mocks.routeCalls.at(-1)?.slippageBps).toBe(400n);
    expect(within(confirm).queryByLabelText(/Custom allowed decrease/)).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect((mocks.submit.mock.calls[0]![0] as { args: unknown[] }).args[4]).toBe(960n * TOKEN);
  });

  it("offers no looser tolerance for a failed quote's minimum, which is the mint rate", async () => {
    mocks.quoteFailed = true;
    mocks.cardSimulate.mockRejectedValueOnce(underMin(970n * TOKEN, 990n * TOKEN));
    const confirm = await payFromConfirm();

    await within(confirm).findByText(
      "This payment would get fewer tokens than your minimum, so lower your minimum or try again.",
    );
    expect(within(confirm).queryByLabelText(/Custom allowed decrease/)).toBeNull();
    expect(within(confirm).queryByRole("button", { name: "Review again" })).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("caps the looser tolerance below half, so the minimum never nears zero", async () => {
    mocks.cardSimulate.mockRejectedValueOnce(underMin(1n, 990n * TOKEN));
    const confirm = await payFromConfirm();
    const field = await within(confirm).findByLabelText(/Custom allowed decrease/);
    expect(field).toHaveValue(49.5);
    fireEvent.change(field, { target: { value: "100" } });
    expect(field).toHaveValue(49.5);
    fireEvent.change(field, { target: { value: "49.999" } });
    expect(field).toHaveValue(49.5);
  });

  it("names a failure a looser minimum cannot fix, and offers no tolerance", async () => {
    mocks.cardSimulate.mockRejectedValueOnce(notAccepting());
    const confirm = await payFromConfirm();
    await within(confirm).findByText("This project is not accepting payments right now.");
    expect(within(confirm).queryByLabelText(/Custom allowed decrease/)).toBeNull();
    expect(within(confirm).getByRole("button", { name: "Pay" })).toBeInTheDocument();
  });

  it("says a mined payment reverted, then quotes and simulates it again for a reason", async () => {
    mocks.reverted = true;
    const confirm = await payFromConfirm();
    await within(confirm).findByText("The payment reverted.");
    // No replay at the receipt's block: only the send's own simulation ran.
    expect(mocks.cardSimulate).toHaveBeenCalledTimes(1);
    expect(within(confirm).queryByLabelText(/Custom allowed decrease/)).toBeNull();

    const quotes = mocks.routeCalls.length;
    // The fresh simulation, at the latest block, is what names the reason.
    mocks.reverted = false;
    mocks.cardSimulate.mockRejectedValueOnce(underMin(980n * TOKEN, 990n * TOKEN));
    fireEvent.click(within(confirm).getByRole("button", { name: "Review again" }));
    await waitFor(() => expect(mocks.routeCalls.length).toBeGreaterThan(quotes));
    await within(confirm).findByText(
      "This payment would get fewer tokens than your minimum, so lower your minimum or try again.",
    );
    expect(mocks.cardSimulate.mock.calls.at(-1)?.[0]).not.toHaveProperty("blockNumber", 101n);
    expect(within(confirm).getByLabelText(/Custom allowed decrease/)).toHaveValue(2.5);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("drops a loosened tolerance when the review closes or the payment changes", async () => {
    mocks.cardSimulate.mockRejectedValueOnce(underMin(970n * TOKEN, 990n * TOKEN));
    const confirm = await payFromConfirm();
    const again = await within(confirm).findByRole("button", { name: "Review again" });
    // Each review from here fails for a reason no tolerance fixes, so nothing sends.
    mocks.cardSimulate.mockRejectedValue(notAccepting());
    fireEvent.click(again);
    await within(confirm).findByText(/^965 /);
    expect(mocks.routeCalls.at(-1)?.slippageBps).toBe(350n);

    // Change the amount away and back: the tolerance does not come back with it.
    const amount = screen.getByLabelText("Amount");
    fireEvent.change(amount, { target: { value: "2" } });
    await within(confirm).findByText(/^990 /, {}, { timeout: 3_000 });
    const calls = mocks.routeCalls.length;
    fireEvent.change(amount, { target: { value: "1" } });
    await waitFor(() => expect(mocks.routeCalls.length).toBeGreaterThan(calls), { timeout: 3_000 });
    await within(confirm).findByText(/^990 /, {}, { timeout: 3_000 });
    expect(mocks.routeCalls.slice(calls).every((call) => call.slippageBps === undefined)).toBe(
      true,
    );
  });

  it("says a payment would return no tokens, and offers no tolerance for it", async () => {
    mocks.cardSimulate.mockRejectedValueOnce(underMin(0n, 990n * TOKEN));
    const confirm = await payFromConfirm();
    await within(confirm).findByText("This payment would return no tokens.");
    expect(within(confirm).queryByLabelText(/Custom allowed decrease/)).toBeNull();
    expect(within(confirm).getByRole("button", { name: "Pay" })).toBeInTheDocument();
  });

  it("shows a failed swap quote as one line with Retry, and quotes again on Retry", async () => {
    mocks.routeError = new PaySwapQuoteFailedError();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const line = await screen.findByText(new RegExp(PAY_SWAP_QUOTE_FAILED_MESSAGE));
    expect(screen.queryByText(/Couldn.t check what you will receive/)).toBeNull();
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();

    const calls = mocks.routeCalls.length;
    mocks.routeError = null;
    fireEvent.click(within(line).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled(), {
      timeout: 3_000,
    });
    expect(mocks.routeCalls.length).toBe(calls + 1);
    expect(screen.queryByText(new RegExp(PAY_SWAP_QUOTE_FAILED_MESSAGE))).toBeNull();
  });

  it("frees a payment whose send could not start, says so and offers it again, nothing sent", async () => {
    // The reviewed send's own preparation failed before any wallet: its result says so.
    mocks.run!.mockResolvedValueOnce({
      status: "failed",
      error: REVIEWED_ENGINE_LOAD_LINE,
      failure: new ReviewRefusal(REVIEWED_ENGINE_LOAD_LINE),
    });
    const confirm = await payFromConfirm();
    await within(confirm).findByText(REVIEWED_ENGINE_LOAD_LINE);
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  });
});
