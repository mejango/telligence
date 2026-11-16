import { V6PayCard } from "@/app/[slug]/components/v6/pay/V6PayCard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// One user action, one in-app confirmation: the action's button opens its progress and core's
// review straight away, with every call the action needs (an ERC-20 approval and the payment)
// reviewed together. No second "confirm" button stands between the click and the review.

const HASH = `0x${"ab".repeat(32)}` as Hex;
const TKN = "0x7777777777777777777777777777777777777777";

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111" as string | undefined,
  metadata: {
    metadata: { data: { payDisclosure: "No refunds." } },
    fullMetadataLoading: false,
  },
  write: vi.fn(),
  simulate: vi.fn(),
  routeError: null as Error | null,
  routeGate: null as Promise<void> | null,
  routeCalls: 0,
  terminal: "0x3333333333333333333333333333333333333333",
  minReturned: 99n * 10n ** 19n,
  quoteFailed: false,
  shop: undefined as unknown,
  cart: [] as unknown[],
  erc20: true,
  verifiedPairs: [{ peerChainId: 1, projectId: 7n }],
  suckersVerified: true,
  runner: null as null | {
    reset: () => void;
    holdReview: () => () => void;
    run: { mock: { calls: { calls: { functionName: string }[]; context?: unknown[] }[][] } };
  },
}));

vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  resolvePaymentTerminal: async () => ({ address: mocks.terminal, isRouter: false }),
}));

const WAGMI_CONFIG = vi.hoisted(() => ({}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  // The pay card reads the connection through the provider's config; a stable stand-in here.
  useConfig: () => WAGMI_CONFIG,
  useAccount: () => ({ address: mocks.address, isConnected: true }),
  // Allowance reads answer zero, and the account has code: a contract wallet approves the
  // terminal for the exact amount.
  usePublicClient: () => ({
    simulateContract: mocks.simulate,
    readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) =>
      functionName === "allowance" && args.length === 3 ? [0n, 0, 0] : 0n,
    getBlock: async () => ({ timestamp: 1_700_000_000n }),
    getCode: async () => "0x60",
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
vi.mock("@/components/GetFunds", () => ({
  useOnRamp: () => ({ supported: false, buy: vi.fn() }),
}));
vi.mock("@/components/IpfsImage", () => ({ ImageWithFallback: () => null }));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { liveReviewedAction } = await import("./support/reviewed-action");
  const runner = liveReviewedAction(mocks.write, () => undefined, mocks.simulate);
  mocks.runner = runner as never;
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: runner.hook,
  };
});
vi.mock("@/hooks/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: new Map([
      ["0x000000000000000000000000000000000000EEEe", 10n ** 20n],
      [TKN, 10n ** 20n],
    ]),
    isLoading: false,
  }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
  useJBProjectMetadataContext: () => mocks.metadata,
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
  mocks.metadata.fullMetadataLoading = false;
  mocks.runner?.reset();
  mocks.write.mockReset().mockResolvedValue(HASH);
  mocks.simulate.mockReset().mockResolvedValue({ request: {} });
});

describe("one in-app confirmation per action", () => {
  it("wallet-action:pay opens one review for an ERC-20 payment and its approval from the Pay button", async () => {
    const release = mocks.runner!.holdReview();
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);

    // The one click reaches core's review, with the approval and the payment in it.
    await waitFor(() => expect(mocks.runner!.run).toHaveBeenCalledTimes(1));
    const action = mocks.runner!.run.mock.calls[0]![0];
    expect(action.calls.map((call) => call.functionName)).toEqual(["approve", "pay"]);
    // The review carries the project's payment notice as it read when the payment was prepared.
    expect(action.context).toContainEqual({
      label: "Project notice",
      value: "No refunds.",
      strong: true,
    });
    // Beside core's review, only the action's progress is open, and it asks for nothing.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Pay" })).toBe(pay);
    expect(mocks.write).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
    expect(mocks.runner!.run).toHaveBeenCalledTimes(1);
  });

  it("keeps Pay off until the full metadata file, where the payment notice lives, is read", async () => {
    mocks.metadata.fullMetadataLoading = true;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
  });
});
