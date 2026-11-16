import { V6PayCard } from "@/app/[slug]/components/v6/pay/V6PayCard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parseUnits, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the amount means, and so what the receipt and the on-ramp may do with it.

const NATIVE = "0x000000000000000000000000000000000000EEEe" as Address;
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const HOOK = "0x4444444444444444444444444444444444444444" as Address;
/** JBPrices at about 2,230 USD per ETH: ETH wei for one dollar. */
const WEI_PER_DOLLAR = 448363759259978n;

const token = (address: Address, symbol: string, decimals: number) => ({
  token: address,
  symbol,
  decimals,
  currency: 61166,
  viaRouter: false,
});

const mocks = vi.hoisted(() => ({
  chainId: 1,
  supported: true,
  buy: vi.fn(),
  routeAmounts: [] as bigint[],
  routeDelay: null as Promise<void> | null,
  cart: [] as Record<string, unknown>[],
  shop: undefined as unknown,
  routes: undefined as unknown,
  tokensByChain: {} as Record<number, unknown[]>,
  surfaceError: false,
  surfaceFetching: false,
  refetchSurface: vi.fn(),
  setSelectedSucker: vi.fn(),
  balance: 10n ** 20n,
}));

const WAGMI_CONFIG = vi.hoisted(() => ({}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  // The pay card reads the connection through the provider's config; a stable stand-in here.
  useConfig: () => WAGMI_CONFIG,
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
    isConnected: true,
  }),
  usePublicClient: () => ({ readContract: async () => WEI_PER_DOLLAR }),
}));
vi.mock("@/hooks/useReviewedAction", () => ({
  useReviewedAction: () => ({ run: vi.fn(), phase: "idle" }),
}));
vi.mock("@/components/GetFunds", () => ({
  useOnRamp: () => ({ supported: mocks.supported, buy: mocks.buy }),
}));
vi.mock("@/components/IpfsImage", () => ({ ImageWithFallback: () => null }));
vi.mock("@/hooks/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: new Map(
      (mocks.tokensByChain[mocks.chainId] as { token: string }[]).map((t) => [
        t.token,
        mocks.balance,
      ]),
    ),
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
  useSuckers: () => ({
    data: [
      { peerChainId: 1, projectId: 7n },
      { peerChainId: 8453, projectId: 7n },
    ],
    verifiedPairs: [
      { peerChainId: 1, projectId: 7n },
      { peerChainId: 8453, projectId: 7n },
    ],
  }),
}));
vi.mock("@/lib/paymentTerminal", () => ({
  resolveBestV6PayRoute: async ({ amount }: { amount: bigint }) => {
    mocks.routeAmounts.push(amount);
    if (mocks.routeDelay) await mocks.routeDelay;
    return {
      address: "0x3333333333333333333333333333333333333333",
      type: "multi",
      // 352 REV per whole ETH.
      preview: { beneficiaryTokenCount: amount * 352n, reservedTokenCount: 0n },
      metadata: "0x",
      minReturnedTokens: amount * 350n,
      quoteFailed: false,
    };
  },
}));
vi.mock("@/providers/ParaAuthContext", () => ({
  useParaAuth: () => ({ requestSignIn: vi.fn() }),
}));
vi.mock("@/app/[slug]/components/PayCard/SelectedSuckerContext", () => ({
  useSelectedSucker: () => ({
    selectedSucker: { peerChainId: mocks.chainId, projectId: 7n },
    setSelectedSucker: mocks.setSelectedSucker,
  }),
}));
vi.mock("@/app/[slug]/components/v6/ShopCartContext", () => ({
  useShopCart: () => ({ items: mocks.cart, remove: vi.fn(), setQuantity: vi.fn() }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePayShop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/pay/usePayShop")>()),
  usePayShop: () => ({ data: mocks.shop }),
  usePayShopCredits: () => ({ data: 0n, isLoading: false }),
  usePayShopRoutes: () => ({ data: mocks.routes, isLoading: false }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePaySurface", () => ({
  usePaySurface: () => ({
    data: mocks.surfaceError
      ? undefined
      : {
          tokens: mocks.tokensByChain[mocks.chainId],
          routingUnavailable: false,
          rulesetStart: 0,
          pausePay: false,
          terminals: [],
        },
    isError: mocks.surfaceError,
    isFetching: mocks.surfaceFetching,
    refetch: mocks.refetchSurface,
  }),
}));
vi.mock("@/app/[slug]/components/v6/pay/V6PayShopStrip", () => ({ V6PayShopStrip: () => null }));

const queryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

function renderCard() {
  const client = queryClient();
  const card = () => (
    <QueryClientProvider client={client}>
      <V6PayCard />
    </QueryClientProvider>
  );
  const view = render(card());
  return { rerender: () => view.rerender(card()) };
}

const amountInput = () => screen.getByLabelText("Amount") as HTMLInputElement;
const typeAmount = (value: string) => fireEvent.change(amountInput(), { target: { value } });
const pickToken = (value: string) =>
  fireEvent.change(screen.getByLabelText("Payment token"), { target: { value } });

beforeEach(() => {
  mocks.chainId = 1;
  mocks.supported = true;
  mocks.buy.mockReset();
  mocks.routeAmounts = [];
  mocks.routeDelay = null;
  mocks.cart = [];
  mocks.shop = undefined;
  mocks.routes = undefined;
  mocks.tokensByChain = {
    1: [token(NATIVE, "ETH", 18), token(USDC_ETH, "USDC", 6)],
    8453: [token(NATIVE, "ETH", 18), token(USDC_BASE, "USDC", 6)],
  };
  mocks.surfaceError = false;
  mocks.surfaceFetching = false;
  mocks.refetchSurface.mockReset();
  mocks.balance = 10n ** 20n;
});
afterEach(() => cleanup());

describe("Card or bank", () => {
  it("stays picked on a first pick", async () => {
    renderCard();
    pickToken("buy");
    await waitFor(() => expect(amountInput().placeholder).toBe("$0.00"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((screen.getByLabelText("Payment token") as HTMLSelectElement).value).toBe("buy");
  });

  it("quotes $25 at what $25 buys, never 25 tokens", async () => {
    renderCard();
    pickToken("buy");
    typeAmount("25");

    // 25 * 0.000448363... ETH * 352 REV: about 3.9456 REV, where the bug showed 8,800.
    await screen.findByText("3.9456 REV");
    expect(screen.getByText("You get about")).toBeInTheDocument();
    expect(screen.getByText("Before card or bank fees")).toBeInTheDocument();
    expect(screen.queryByText(/^At least/)).toBeNull();
    expect(mocks.routeAmounts).toEqual([25n * WEI_PER_DOLLAR]);
    expect(mocks.routeAmounts).not.toContain(parseUnits("25", 18));
  });

  it("hands the provider the dollars typed", async () => {
    renderCard();
    pickToken("buy");
    typeAmount("25");
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(await screen.findByRole("button", { name: "Buy ETH" }));
    expect(mocks.buy).toHaveBeenCalledWith({ fiatQuantity: "25" });
  });

  it("clears the digits when they change unit", async () => {
    renderCard();
    pickToken("buy");
    typeAmount("25");
    pickToken("0");
    await waitFor(() => expect(amountInput().value).toBe(""));
  });

  it("is not offered where it cannot buy anything, even to an empty wallet", async () => {
    mocks.supported = false;
    mocks.balance = 0n;
    renderCard();
    await waitFor(() => expect(amountInput().placeholder).toBe("0.00"));
  });

  describe("with items in the cart", () => {
    beforeEach(() => {
      mocks.shop = {
        hook: HOOK,
        idTarget: HOOK,
        store: HOOK,
        pricingCurrency: 1,
        pricingDecimals: 18,
        tiers: [
          {
            id: 1,
            price: 10n ** 18n,
            discountPercent: 0,
            remaining: 5,
            unlimited: false,
            cantBuyWithCredits: false,
            resolvedUri: "",
            encodedIpfsUri: `0x${"0".repeat(64)}`,
          },
        ],
      };
      mocks.routes = {
        [`${NATIVE.toLowerCase()}:false`]: { supported: true, pricePerUnit: 10n ** 18n },
      };
      mocks.cart = [
        { tierId: 1n, quantity: 1, price: 10n ** 18n, currency: 1, hook: HOOK, chainId: 1 },
      ];
    });

    it("keeps the total in tokens and buys the token, not that many dollars", async () => {
      renderCard();
      await waitFor(() => expect(amountInput().value).toBe("1"));
      pickToken("buy");
      await waitFor(() => expect(amountInput().value).toBe("1"));
      fireEvent.click(screen.getByRole("button", { name: "Pay" }));
      fireEvent.click(await screen.findByRole("button", { name: "Buy ETH" }));
      expect(mocks.buy).toHaveBeenCalledWith(undefined);
    });

    it("clears the total when the cart empties", async () => {
      const { rerender } = renderCard();
      await waitFor(() => expect(amountInput().value).toBe("1"));
      mocks.cart = [];
      rerender();
      await waitFor(() => expect(amountInput().value).toBe(""));
    });

    it("names a cart on another chain, and switches to it", async () => {
      mocks.chainId = 8453;
      renderCard();
      expect(await screen.findByText(/1 item in your Ethereum cart/)).toBeInTheDocument();
      expect(amountInput().value).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "Switch" }));
      expect(mocks.setSelectedSucker).toHaveBeenCalledWith({ peerChainId: 1, projectId: 7n });
    });
  });
});

describe("a chain switch", () => {
  it("keeps a picked token the new chain also accepts", async () => {
    const { rerender } = renderCard();
    pickToken("1");
    mocks.chainId = 8453;
    rerender();
    await waitFor(() =>
      expect((screen.getByLabelText("Payment token") as HTMLSelectElement).value).toBe("1"),
    );
    expect(screen.queryByText(/isn't accepted on/)).toBeNull();
  });

  it("says so and clears the digits when the new chain does not accept it", async () => {
    const { rerender } = renderCard();
    pickToken("1");
    typeAmount("100");
    mocks.tokensByChain[8453] = [token(NATIVE, "ETH", 18)];
    mocks.chainId = 8453;
    rerender();
    expect(await screen.findByText("USDC isn't accepted on Base.")).toBeInTheDocument();
    expect(amountInput().value).toBe("");
  });
});

describe("a quote on its way", () => {
  it("dims another amount's figure and shows no figure from another token", async () => {
    renderCard();
    typeAmount("1");
    const figure = await screen.findByText("352 REV");
    expect(figure.className).not.toContain("opacity-40");

    let release = () => {};
    mocks.routeDelay = new Promise((resolve) => (release = resolve));
    typeAmount("2");
    await waitFor(() => expect(screen.getByText("352 REV").className).toContain("opacity-40"));

    pickToken("1");
    await waitFor(() => expect(screen.queryByText("352 REV")).toBeNull());
    expect(screen.getByRole("status", { name: "Calculating token return" })).toBeInTheDocument();
    release();
  });
});

describe("the accepted-tokens verdict", () => {
  it("waits while the failed read is being read again", () => {
    mocks.surfaceError = true;
    mocks.surfaceFetching = true;
    renderCard();
    expect(screen.queryByText(/Payments are off/)).toBeNull();
  });

  it("offers another try once the read has settled as failed", () => {
    mocks.surfaceError = true;
    renderCard();
    expect(screen.getByText(/Payments are off/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetchSurface).toHaveBeenCalled();
  });
});

describe("the note's limit", () => {
  const note = () => screen.getByPlaceholderText("Add a note") as HTMLTextAreaElement;

  it("stays quiet until the note nears it", () => {
    renderCard();
    fireEvent.change(note(), { target: { value: "a".repeat(200) } });
    expect(screen.queryByText("200/256")).toBeNull();
    fireEvent.change(note(), { target: { value: "a".repeat(201) } });
    expect(screen.getByText("201/256")).toBeInTheDocument();
  });

  it("shows the cut when a paste runs over", () => {
    renderCard();
    expect(note().maxLength).toBe(256);
    fireEvent.change(note(), { target: { value: "a".repeat(300) } });
    expect(note().value).toHaveLength(256);
    expect(screen.getByText("256/256")).toBeInTheDocument();
  });
});
