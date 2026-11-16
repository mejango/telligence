import { V6PayCard } from "@/app/[slug]/components/v6/pay/V6PayCard";
import { PAY_QUOTE_FAILED_MESSAGE } from "@bananapus/nana-sdk-core/v6";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A payment's tokens go to the account it was prepared for. When the wallet
// switches accounts with the confirm open, pressing Pay must not send the
// prepared payment from the new account: the new account would pay and the
// old one would receive. It rebuilds the payment for the account now
// connected and says so, and only the next press pays.

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111" as string | undefined,
  balances: new Map<string, bigint>(),
  write: vi.fn(),
  simulate: vi.fn(),
  /** The connected account has no code: it can sign a Permit2 allowance. */
  plainWallet: false,
  sign: vi.fn(),
  routeError: null as Error | null,
  terminal: "0x3333333333333333333333333333333333333333",
  minReturned: 99n * 10n ** 19n,
  quoteFailed: false,
  routeCalls: 0,
  routeGate: null as Promise<void> | null,
  shop: undefined as unknown,
  cart: [] as unknown[],
  erc20: false,
  /** A Safe app is connected: a batch run is one proposal. */
  safeBatch: false,
  /** How the run of a sent hash ends, as core's would. */
  end: (() => undefined) as (hash: `0x${string}`) => unknown,
  runner: null as null | {
    reset: () => void;
    holdReview: () => () => void;
    run: { mock: { calls: { context?: unknown }[][] } };
    set: (patch: { phase?: string; held?: unknown; error?: string | null }) => void;
    state: { phase: string };
  },
  verifiedPairs: [{ peerChainId: 1, projectId: 7n }] as {
    peerChainId: number;
    projectId: bigint;
  }[],
  suckersVerified: true,
}));

const TKN = "0x7777777777777777777777777777777777777777" as Address;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const SHOP_HOOK = "0x4444444444444444444444444444444444444444" as Address;
const SHOP = {
  hook: SHOP_HOOK,
  idTarget: "0x5555555555555555555555555555555555555555",
  pricingCurrency: 61166,
  pricingDecimals: 18,
  tiers: [
    {
      id: 1,
      price: 10n ** 17n,
      discountPercent: 0,
      remaining: 10,
      unlimited: true,
      cantBuyWithCredits: false,
      resolvedUri: "",
      encodedIpfsUri: "0x",
    },
  ],
};
const cartOf = (quantity: number) => [
  {
    tierId: 1n,
    quantity,
    price: 10n ** 17n,
    currency: 61166,
    hook: SHOP_HOOK,
    chainId: 1,
    name: "Hat",
  },
];

vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  resolvePaymentTerminal: async () => ({ address: mocks.terminal, isRouter: false }),
  // The metadata names how many items the payment mints, so a stale cart is visible.
  prepareUserPay: async (_client: unknown, args: { tiers?: { tierIdsToMint: bigint[] } }) => ({
    preview: { beneficiaryTokenCount: 10n ** 21n, reservedTokenCount: 0n },
    metadata: `0x${(args.tiers?.tierIdsToMint.length ?? 0).toString(16).padStart(2, "0")}`,
    minReturnedTokens: mocks.minReturned,
  }),
}));

const WAGMI_CONFIG = vi.hoisted(() => ({}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  // The pay card reads the connection through the provider's config; a stable stand-in here.
  useConfig: () => WAGMI_CONFIG,
  useAccount: () => ({ address: mocks.address, isConnected: true }),
  // Allowance reads answer zero, and the account has code unless a test says it is a plain
  // wallet: a contract wallet approves the terminal for the exact amount.
  usePublicClient: () => ({
    simulateContract: mocks.simulate,
    readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) =>
      functionName === "allowance" && args.length === 3 ? [0n, 0, 0] : 0n,
    getBlock: async () => ({ timestamp: 1_700_000_000n }),
    getCode: async () => (mocks.plainWallet ? undefined : "0x60"),
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
vi.mock("@/lib/safe-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-connector")>()),
  isSafeConnection: () => mocks.safeBatch,
}));
vi.mock("@/components/GetFunds", () => ({
  useOnRamp: () => ({ supported: false, buy: vi.fn() }),
}));
vi.mock("@/components/IpfsImage", () => ({ ImageWithFallback: () => null }));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { liveReviewedAction } = await import("./support/reviewed-action");
  const runner = liveReviewedAction(
    mocks.write,
    (hash) => mocks.end(hash) as never,
    mocks.simulate,
    () => mocks.safeBatch,
  );
  mocks.runner = runner as never;
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: runner.hook,
    // Core shows and signs the allowance; the card's part is when it asks and what it sends.
    signPayAuthorization: (...args: unknown[]) => mocks.sign(...args),
  };
});
vi.mock("@/hooks/useTokenBalances", () => ({
  useTokenBalances: () => ({ balances: mocks.balances, isLoading: false }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
  useJBProjectMetadataContext: () => ({ metadata: { data: { payDisclosure: "No refunds." } } }),
}));
vi.mock("@/lib/nana/suckers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nana/suckers")>()),
  useSuckers: () => ({
    data: [{ peerChainId: 1, projectId: 7n }],
    verifiedPairs: mocks.verifiedPairs,
    isVerified: mocks.suckersVerified,
    isError: false,
  }),
}));
vi.mock("@/lib/paymentTerminal", () => ({
  resolveBestV6PayRoute: async () => {
    mocks.routeCalls += 1;
    if (mocks.routeGate) await mocks.routeGate;
    if (mocks.routeError) throw mocks.routeError;
    return {
      quoteFailed: mocks.quoteFailed,
      address: mocks.terminal,
      type: "multi",
      preview: { beneficiaryTokenCount: 10n ** 21n, reservedTokenCount: 0n },
      metadata: "0x5150",
      minReturnedTokens: mocks.minReturned,
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
  useShopCart: () => ({ items: mocks.cart, remove: vi.fn(), setQuantity: vi.fn() }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePayShop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/pay/usePayShop")>()),
  usePayShop: () => ({ data: mocks.shop }),
  usePayShopCredits: () => ({ data: 0n, isLoading: false }),
  usePayShopRoutes: () => ({
    data: mocks.shop
      ? {
          [`${mocks.erc20 ? TKN.toLowerCase() : "0x000000000000000000000000000000000000eeee"}:false`]:
            {
              supported: true,
              pricePerUnit: 10n ** 18n,
            },
        }
      : undefined,
    isLoading: false,
  }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePaySurface", () => {
  const surfaceOf = (token: string, symbol: string) => ({
    tokens: [{ token, decimals: 18, currency: 61166, symbol, viaRouter: false }],
    rulesetStart: 0,
    pausePay: false,
    terminals: ["0x3333333333333333333333333333333333333333"],
  });
  const eth = surfaceOf("0x000000000000000000000000000000000000EEEe", "ETH");
  const tkn = surfaceOf("0x7777777777777777777777777777777777777777", "TKN");
  return { usePaySurface: () => ({ data: mocks.erc20 ? tkn : eth, isError: false }) };
});
vi.mock("@/app/[slug]/components/v6/pay/V6PayShopStrip", () => ({ V6PayShopStrip: () => null }));

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  window.localStorage.clear();
  mocks.address = A;
  mocks.balances = new Map([
    ["0x000000000000000000000000000000000000EEEe", 10n ** 20n],
    [TKN, 10n ** 20n],
  ]);
  mocks.routeError = null;
  mocks.terminal = "0x3333333333333333333333333333333333333333";
  mocks.minReturned = 99n * 10n ** 19n;
  mocks.quoteFailed = false;
  mocks.routeCalls = 0;
  mocks.routeGate = null;
  mocks.shop = undefined;
  mocks.cart = [];
  mocks.erc20 = false;
  mocks.verifiedPairs = [{ peerChainId: 1, projectId: 7n }];
  mocks.suckersVerified = true;
  mocks.end = () => undefined;
  mocks.runner?.reset();
  mocks.plainWallet = false;
  mocks.safeBatch = false;
  mocks.sign.mockReset().mockResolvedValue(`0x${"cd".repeat(65)}`);
  mocks.write.mockReset().mockResolvedValue(HASH);
  mocks.simulate.mockReset().mockResolvedValue({ request: {} });
});

describe("the wallet balance under the amount", () => {
  it("shows a failed balance read as unavailable, never 0, and claims no shortfall", async () => {
    mocks.balances = new Map([[TKN, 10n ** 20n]]);
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    expect(await screen.findByText("Balance unavailable")).toBeTruthy();
    expect(screen.queryByText(/^Balance: 0$/)).toBeNull();
    expect(screen.queryByText(/not enough|insufficient/i)).toBeNull();
  });
});

describe("a payment to a sucker peer", () => {
  it("wallet-action:pay stays off for a pair the on-chain sucker registry does not list", async () => {
    // The selected pair (1, 7) came from the indexer seed; the registry read lists project 8.
    mocks.verifiedPairs = [{ peerChainId: 1, projectId: 8n }];
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(/project listed here isn.t linked onchain/);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const pay = screen.getByRole("button", { name: "Pay" });
    expect(pay).toBeDisabled();
    fireEvent.click(pay);
    expect(screen.queryByRole("dialog", { name: "Confirm payment" })).toBeNull();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("wallet-action:pay keeps one confirmation: a pending registry read is only the button's loading state", async () => {
    mocks.verifiedPairs = [];
    mocks.suckersVerified = false;
    const client = queryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Pending: no message, no extra step, just a busy Pay.
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    expect(screen.queryByText(/belongs to this project|isn.t linked/)).toBeNull();

    // The read lands: the same single press and single confirm pay, as on the home chain.
    mocks.verifiedPairs = [{ peerChainId: 1, projectId: 7n }];
    mocks.suckersVerified = true;
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("a payment bound to the account it was prepared for", () => {
  it("wallet-action:pay rebuilds the payment for a newly connected account instead of paying the old one's tokens from it", async () => {
    const client = queryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    const release = mocks.runner!.holdReview();
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    // The wallet switches accounts while the payment's review is open.
    mocks.address = B;
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    release();

    await within(confirm).findByText("The payment changed. Review it again.");
    expect(mocks.write).not.toHaveBeenCalled();

    // Rebuilt for B: the next review pays from B, to B.
    fireEvent.click(await within(confirm).findByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const payment = mocks.write.mock.calls[0]![0] as {
      chainId: number;
      account: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(payment.functionName).toBe("pay");
    expect(payment.account).toBe(B);
    // The payment names its chain; the reviewed write switches the wallet to it.
    expect(payment).toMatchObject({ chainId: 1 });
    // pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)
    expect(payment.args[3]).toBe(B);
    // The terminal is paid with exactly the prepared buyback metadata and minimum.
    expect(payment.args[4]).toBe(99n * 10n ** 19n);
    expect(payment.args[6]).toBe("0x5150");
    expect(mocks.simulate).toHaveBeenCalledWith(expect.objectContaining({ account: B }));
  });

  it("blocks the payment when the pay preparation fails, and lets it through once a retry succeeds", async () => {
    mocks.routeError = new Error("buyback hookOf read failed");
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(/Couldn.t check what you will receive/, undefined, { timeout: 3_000 });
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    expect(mocks.write).not.toHaveBeenCalled();

    mocks.routeError = null;
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled(), {
      timeout: 3_000,
    });
  });

  it("does not prepare from the old quote when the confirm's refetch fails", async () => {
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    // The card holds a good quote; the confirm's refetch of it fails.
    mocks.routeError = new Error("buyback hookOf read failed");
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText(/Couldn.t verify what this payment returns/);
    expect(within(confirm).queryByText("You get at least")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rebuilds a ready payment whose route moved to another terminal, and never sends the old one", async () => {
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    const release = mocks.runner!.holdReview();
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    const moved = "0x6666666666666666666666666666666666666666";
    mocks.terminal = moved;
    await client.invalidateQueries({ queryKey: ["v6PayPreview"] });
    release();
    await within(confirm).findByText("The payment changed. Review it again.");
    fireEvent.click(await within(confirm).findByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({ address: moved });
  });

  it("rebuilds a ready item checkout when the cart changes, and never sends the old items", async () => {
    mocks.shop = SHOP;
    mocks.cart = cartOf(1);
    const client = queryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    const release = mocks.runner!.holdReview();
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    mocks.cart = cartOf(2);
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    release();
    await within(confirm).findByText("The payment changed. Review it again.");
    await within(confirm).findByText("2× Hat");
    fireEvent.click(await within(confirm).findByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const payment = mocks.write.mock.calls[0]![0] as { args: readonly unknown[] };
    // pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)
    expect(payment.args[2]).toBe(2n * 10n ** 17n);
    expect(payment.args[6]).toBe("0x02");
  });

  it("labels the card's preview an estimate and shows the enforced minimum when they differ", async () => {
    mocks.minReturned = 5n * 10n ** 20n;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText("You get about", undefined, { timeout: 3_000 });
    expect(screen.getByText("1,000 REV")).toBeInTheDocument();
    expect(screen.getByText("At least 500 REV")).toBeInTheDocument();
  });

  it("says when the minimum is only the mint rate, and shows progress instead while the quote is read again", async () => {
    mocks.quoteFailed = true;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });

    const gate = deferred<void>();
    mocks.routeGate = gate.promise;
    mocks.quoteFailed = false;
    const calls = mocks.routeCalls;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Refreshing…");
    expect(mocks.routeCalls).toBeGreaterThan(calls);
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    gate.resolve();
    await waitFor(() => expect(screen.queryByText("Refreshing…")).toBeNull());
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
  });

  it("shows a new amount's failed quote while the last amount's retry is still reading", async () => {
    mocks.quoteFailed = true;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });

    const gate = deferred<void>();
    mocks.routeGate = gate.promise;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Refreshing…");

    mocks.routeGate = null;
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Refreshing…")).toBeNull();

    // Retrying the new amount keeps its progress when the last amount's retry settles first.
    const second = deferred<void>();
    mocks.routeGate = second.promise;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Refreshing…");
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    second.resolve();
  });

  it("hides the failed-quote line as soon as the amount changes, until that amount's quote arrives", async () => {
    mocks.quoteFailed = true;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });

    const gate = deferred<void>();
    mocks.routeGate = gate.promise;
    const calls = mocks.routeCalls;
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
    // Gone while the new amount is debounced...
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
    // ...and while its quote loads behind the last amount's.
    await waitFor(() => expect(mocks.routeCalls).toBeGreaterThan(calls), { timeout: 3_000 });
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();

    gate.resolve();
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });
  });

  it("keeps the failed-quote line through a background refetch the payer did not ask for", async () => {
    mocks.quoteFailed = true;
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });

    const gate = deferred<void>();
    mocks.routeGate = gate.promise;
    const calls = mocks.routeCalls;
    void client.refetchQueries({ queryKey: ["v6PayPreview"] });
    await waitFor(() => expect(mocks.routeCalls).toBeGreaterThan(calls));
    expect(screen.getByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Refreshing…")).toBeNull();
    gate.resolve();
  });

  it("discloses a failed quote found at submit in the review, bound to the minimum it signs, and not on the card once sent", async () => {
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();

    // The card looked healthy; the quote read again at submit could not read the pool.
    mocks.quoteFailed = true;
    mocks.minReturned = 7n * 10n ** 20n;
    // A failed attempt's error stands alone; the quote line does not come back beside it.
    mocks.simulate.mockRejectedValueOnce(new Error("Simulation failed"));
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await waitFor(() => expect(mocks.runner!.run.mock.calls).toHaveLength(1));
    // Said in the review, beside the minimum it signs.
    expect(mocks.runner!.run.mock.calls[0]![0].context).toContainEqual({
      label: "You get at least",
      value: "700 REV",
      note: PAY_QUOTE_FAILED_MESSAGE,
    });
    await waitFor(() => expect(confirm.querySelector(".text-red-600")).not.toBeNull());
    expect(within(confirm).queryByText(PAY_QUOTE_FAILED_MESSAGE)).toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const payment = mocks.write.mock.calls[0]![0] as { args: readonly unknown[] };
    expect(payment.args[4]).toBe(7n * 10n ** 20n);
    await within(confirm).findByText("Your payment went through.");
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
  });

  it("does not send a ready payment after its quote refresh fails", async () => {
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    mocks.routeError = new Error("buyback hookOf read failed");
    await client.invalidateQueries({ queryKey: ["v6PayPreview"] });
    await within(confirm).findByText(/Couldn.t verify what this payment returns/);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("stops a payment whose route moves to another terminal while it is being simulated", async () => {
    const simulation = deferred<{ request: object }>();
    mocks.simulate.mockReturnValueOnce(simulation.promise);
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");
    await waitFor(() => expect(mocks.simulate).toHaveBeenCalledTimes(1));

    const moved = "0x6666666666666666666666666666666666666666";
    mocks.terminal = moved;
    await client.invalidateQueries({ queryKey: ["v6PayPreview"] });
    simulation.resolve({ request: {} });

    await within(confirm).findByText("The payment changed. Review it again.");
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.click(await within(confirm).findByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({ address: moved });
  });

  it("stops an ERC-20 item checkout whose cart changes while its approval is pending", async () => {
    mocks.erc20 = true;
    mocks.shop = SHOP;
    mocks.cart = cartOf(1);
    const approval = deferred<Hex>();
    mocks.write.mockReturnValueOnce(approval.promise);
    const client = queryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("Approve TKN access");
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    // The terminal being paid is the spender, for exactly the payment amount.
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({
      address: TKN,
      functionName: "approve",
      args: [mocks.terminal, 10n ** 17n],
    });

    mocks.cart = cartOf(2);
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    approval.resolve(HASH);

    await within(confirm).findByText("The payment changed. Review it again.");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    await within(confirm).findByText("2× Hat");
    fireEvent.click(await within(confirm).findByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(3));
    expect(mocks.write.mock.calls[1]![0]).toMatchObject({
      functionName: "approve",
      args: [mocks.terminal, 2n * 10n ** 17n],
    });
    const payment = mocks.write.mock.calls[2]![0] as { args: readonly unknown[]; value: bigint };
    expect(payment.args[1]).toBe(TKN);
    expect(payment.args[2]).toBe(2n * 10n ** 17n);
    expect(payment.args[6]).toBe("0x02");
    expect(payment.value).toBe(0n);
  });

  it("sends the token approval again after one that reverted, never the payment alone", async () => {
    mocks.erc20 = true;
    mocks.shop = SHOP;
    mocks.cart = cartOf(1);
    let sends = 0;
    mocks.end = () =>
      ++sends === 1 ? { phase: "failed", error: "The approval reverted." } : undefined;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("Approve TKN access");
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));

    fireEvent.click(await within(confirm).findByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(3));
    expect(mocks.write.mock.calls[1]![0]).toMatchObject({ functionName: "approve" });
  });

  it("has a plain wallet sign the exact payment first, approve Permit2 once, then pay with the signature", async () => {
    mocks.erc20 = true;
    mocks.shop = SHOP;
    mocks.cart = cartOf(1);
    mocks.plainWallet = true;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("Authorize the payment (free signature)");
    await within(confirm).findByText("Let Permit2 move your TKN (one time)");
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));

    // One signature, for the terminal alone, asked for before anything is sent.
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const [, authorization, account] = mocks.sign.mock.calls[0]!;
    expect(account).toBe(A);
    expect(authorization).toMatchObject({ spender: mocks.terminal, token: TKN, nonce: 0 });
    expect(mocks.sign.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.write.mock.invocationCallOrder[0]!,
    );
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({
      functionName: "approve",
      args: ["0x000000000022D473030F116dDEE9F6B43aC78BA3", 2n ** 256n - 1n],
    });
    const payment = mocks.write.mock.calls[1]![0] as { functionName: string; args: unknown[] };
    expect(payment.functionName).toBe("pay");
    // The payment's metadata carries the signed allowance for exactly its amount.
    expect(String(payment.args.at(-1))).toContain("cd".repeat(65));
    expect(authorization.amount).toBe(payment.args[2]);
  });

  it("sends nothing when the payer declines the signature", async () => {
    mocks.erc20 = true;
    mocks.shop = SHOP;
    mocks.cart = cartOf(1);
    mocks.plainWallet = true;
    mocks.sign.mockRejectedValue(new Error("User rejected the request."));
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    await within(confirm).findByRole("button", { name: "Pay" });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("returns to the payment, not its success, once the Safe runs the token approval it proposed", async () => {
    mocks.erc20 = true;
    mocks.shop = SHOP;
    mocks.cart = cartOf(1);
    mocks.end = () => ({ phase: "proposed" });
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("Approve TKN access");
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({ functionName: "approve" });

    // The Safe runs the approval after the run ended: core goes idle with the approval settled,
    // and the payment is still to send.
    act(() => mocks.runner!.set({ phase: "idle", held: null, settledStep: 0 } as never));
    await within(confirm).findByText(
      "Your Safe approved the token. Review the payment again to send it.",
    );
    await within(confirm).findByRole("button", { name: "Pay" });
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("proposes the token approval and the payment to a Safe as one batch, and takes its success", async () => {
    mocks.erc20 = true;
    mocks.safeBatch = true;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText(/The payment is proposed in Safe/);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(
      (mocks.write.mock.calls[0]![0] as { batch: { functionName: string }[] }).batch.map(
        (call) => call.functionName,
      ),
    ).toEqual(["approve", "pay"]);
    // The batch is held under the payment's own key, so another payment to the revnet waits on it.
    const [approve, payment] = (mocks.write.mock.calls[0]![0] as { batch: { intent: string }[] })
      .batch;
    expect(approve!.intent).toBe(payment!.intent);

    // The Safe runs the batch: the payment is done, with nothing left to review.
    act(() => mocks.runner!.set({ phase: "done", held: null }));
    await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveValue(""));
    expect(
      screen.queryByText("Your Safe approved the token. Review the payment again to send it."),
    ).toBeNull();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("says to check an identical payment's unconfirmed Safe proposal in Safe instead of reporting it proposed", async () => {
    // The hold refuses the payment: its identical Safe proposal's result can't be confirmed.
    mocks.end = () => ({
      phase: "failed",
      error: "Check this proposal in your Safe before sending it again.",
    });
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    await within(confirm).findByText("Check this proposal in your Safe before sending it again.");
    expect(within(confirm).queryByText(/The payment is proposed in Safe/)).toBeNull();
    expect(within(confirm).getByRole("button", { name: "Pay" })).toBeEnabled();
  });

  it("returns from the payment's own Safe proposal to the payment, with its line, once that proposal's result can't be confirmed", async () => {
    const line =
      "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.";
    mocks.end = () => ({ phase: "proposed", held: { line, exit: true } });
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    await within(confirm).findByText(line);
    expect(within(confirm).queryByText(/The payment is proposed in Safe/)).toBeNull();
    expect(within(confirm).getByRole("button", { name: "Pay" })).toBeEnabled();
  });

  it("holds the payment on its own pending Safe proposal, and returns only once its hold offers the exit", async () => {
    const awaiting = "Waiting for your Safe's approvals: 1 of 2.";
    mocks.end = () => ({ phase: "proposed", held: { line: awaiting, exit: false } });
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    await within(confirm).findByText(/The payment is proposed in Safe/);
    // A new approvals line leaves the payment held.
    act(() =>
      mocks.runner!.set({
        held: {
          phase: "awaiting",
          line: "Waiting for your Safe's approvals: 2 of 3.",
          exit: false,
        },
      }),
    );
    expect(within(confirm).getByText(/The payment is proposed in Safe/)).toBeTruthy();
    expect(within(confirm).queryByRole("button", { name: "Pay" })).toBeNull();

    // Its result can't be confirmed while the dialog is open: the hold offers its exit.
    const unconfirmed =
      "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.";
    act(() => mocks.runner!.set({ held: { phase: "held", line: unconfirmed, exit: true } }));
    await within(confirm).findByText(unconfirmed);
    expect(within(confirm).queryByText(/The payment is proposed in Safe/)).toBeNull();
  });

  it("keeps following its own Safe proposal after Close and track status, and clears the paid amount once the Safe runs it", async () => {
    mocks.end = () => ({
      phase: "proposed",
      held: { line: "Waiting for your Safe's approvals: 1 of 2.", exit: false },
    });
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText(/The payment is proposed in Safe/);

    fireEvent.click(within(confirm).getByRole("button", { name: "Close and track status" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm payment" })).toBeNull(),
    );
    // Not dismissed: core's dismiss of a proposal would detach the card from it.
    expect(mocks.runner!.state.phase).toBe("proposed");
    // The Safe runs it: the card, still following it, takes its success.
    act(() => mocks.runner!.set({ phase: "done", held: null }));
    await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveValue(""));
  });

  it("holds the payment when the wallet disconnects with its review open", async () => {
    const client = queryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    const release = mocks.runner!.holdReview();
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    // The progress cannot connect a wallet, so without one its recovery stays shut.
    mocks.address = undefined;
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    release();
    const again = await within(confirm).findByRole("button", { name: /again/ });
    expect(again).toBeDisabled();
    fireEvent.click(again);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("the payment's intent", () => {
  it("is the project and beneficiary alone, so a checkout an emptied cart turned into a pay is the same intent", async () => {
    const { payIntent } = await import("@bananapus/nana-sdk-core/review");
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    // The cart is empty (inventory emptied it): this is a pay.
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));

    // The checkout it was, with a lost reply, had the same intent.
    expect(mocks.write.mock.calls[0]![0].intent).toBe(
      payIntent({ chainId: 1, project: 7n, beneficiary: A }),
    );
  });
});
