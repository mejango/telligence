import type { QuotedStageStart } from "@/app/create/helpers/staleQuote";
import type { RevnetFormData } from "@/app/create/types";
import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ACCOUNT, validRevnetForm } from "./fixtures/revnet";
import { BUNDLE_UUID, HASH, NOW, OTHER_BUNDLE_UUID, payment, relayrApi } from "./relayr-fixtures";
import { answerReviews, stopAnswering } from "./support/core-review";

// The Create page with the real Relayr hook, recovery guard and journal: only
// the wallet, the chain reads and Relayr's API are stubbed.
const mocks = vi.hoisted(() => ({
  config: { id: "create-relayr-config" },
  account: {
    address: "" as Address,
    chainId: 84532 as number,
    isConnected: true,
    connector: { id: "injected", name: "Injected" },
  },
  form: {} as RevnetFormData,
  formProps: {} as {
    relayrResponse?: RelayrPostBundleResponse;
    quotedStageStart?: QuotedStageStart;
    rebuildStaleQuote?: (stale: RelayrPostBundleResponse) => Promise<RelayrPostBundleResponse>;
  },
  setSubmitting: vi.fn(),
  toast: vi.fn(),
  switchChain: vi.fn(),
  signTypedData: vi.fn(),
  sendTransaction: vi.fn(),
  call: vi.fn(),
  readContract: vi.fn(),
  getBlock: vi.fn(),
  feeBound: false,
}));

// Core quotes each Relayr round's fee bound from Relayr before the plan review opens. These
// tests post through their own Relayr stubs, so rounds stay untagged unless a test proves the bound.
vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => {
  const core = await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>();
  return {
    ...core,
    reviewPlan: (
      action: Parameters<typeof core.reviewPlan>[0],
      deps: Parameters<typeof core.reviewPlan>[1],
    ) =>
      core.reviewPlan(
        mocks.feeBound
          ? action
          : { ...action, calls: action.calls.map(({ relayrRound: _round, ...call }) => call) },
        deps,
      ),
  };
});
vi.mock("@/components/layout/Nav", () => ({ Nav: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: mocks.config }));
vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConfig: () => mocks.config,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedData }),
  useSendTransaction: () => ({
    data: undefined,
    error: null,
    isPending: false,
    isSuccess: false,
    sendTransactionAsync: mocks.sendTransaction,
  }),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => mocks.account,
  // One client per chain: a forwarder's domain names the chain whose client read it.
  getPublicClient: (_config: unknown, at?: { chainId?: number }) => ({
    chain: { id: at?.chainId ?? mocks.account.chainId },
    call: mocks.call,
    readContract: (args: object) =>
      mocks.readContract({ ...args, clientChainId: at?.chainId ?? mocks.account.chainId }),
    getBlock: mocks.getBlock,
    getChainId: async () => at?.chainId ?? mocks.account.chainId,
    estimateGas: async () => 21_000n,
    estimateContractGas: async () => 1_000_000n,
  }),
  getWalletClient: async () =>
    (await import("./support/viem-wallet")).viemWallet(
      { signTypedData: mocks.signTypedData },
      () => mocks.account.chainId,
    ),
  switchChain: (_config: unknown, request: { chainId: number }) => mocks.switchChain(request),
  waitForTransactionReceipt: vi.fn(),
}));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getProjectCreationFee: async (_client: unknown, chainId: number) => BigInt(chainId),
}));
vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({
  pinProjectMetadata: async () => "bafy-metadata",
}));
vi.mock("@/app/create/helpers/feedReachability", () => ({
  assertLaunchFeedsReachable: async () => undefined,
}));
vi.mock("@/app/create/form/DeployRevnetForm", () => ({
  DeployRevnetForm: (props: typeof mocks.formProps) => {
    mocks.formProps = props;
    return null;
  },
}));
vi.mock("@/lib/forms", () => ({
  FormProvider: ({
    children,
    onSubmit,
  }: {
    children: ReactNode;
    onSubmit: (
      values: RevnetFormData,
      helpers: { setSubmitting: (submitting: boolean) => void },
    ) => Promise<void>;
  }) => (
    <>
      <button onClick={() => void onSubmit(mocks.form, { setSubmitting: mocks.setSubmitting })}>
        Submit launch fixture
      </button>
      {children}
    </>
  ),
}));

const FIRST_DEADLINE = NOW + 3_600;
const firstPayment = payment({ chain: sepolia.id }, { deadline: FIRST_DEADLINE });
// A launch signed at NOW stays executable for 2 hours.
const PAST_DEADLINE = NOW + 3 * 3_600;
const FINAL_HASH = `0x${"fe".repeat(32)}` as Hex;

/** The finalized block, still canonical, at `timestamp`. */
function finalizedAt(timestamp: number) {
  mocks.getBlock.mockImplementation(async ({ blockTag }: { blockTag?: string }) =>
    blockTag === "finalized"
      ? { number: 200n, hash: FINAL_HASH, timestamp: BigInt(timestamp) }
      : { hash: FINAL_HASH },
  );
}

/** Relayr answers the first launch with BUNDLE_UUID and any later one with OTHER_BUNDLE_UUID. */
function relayrLaunches() {
  const first = relayrApi({ payments: [firstPayment] });
  const next = relayrApi({
    bundleUuid: OTHER_BUNDLE_UUID,
    payments: [
      payment({ chain: sepolia.id }, { bundleUuid: OTHER_BUNDLE_UUID, deadline: NOW + 50 * 3_600 }),
    ],
  });
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/bundle/prepaid")) return (posts++ ? next : first)(input, init);
      return (url.endsWith(OTHER_BUNDLE_UUID) ? next : first)(input, init);
    }),
  );
}

async function createPage() {
  vi.resetModules();
  const [{ default: Page }, review, activity, relayr, staleQuote] = await Promise.all([
    import("@/app/create/RevnetCreate"),
    import("@bananapus/nana-sdk-core/review"),
    import("@/lib/transaction-activity"),
    import("@/hooks/useReviewedRelayr"),
    import("@/app/create/helpers/staleQuote"),
  ]);
  stopAnswering();
  answerReviews(async () => true, review);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
  return { activity, relayr, staleQuote };
}

async function submitLaunch() {
  mocks.setSubmitting.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Submit launch fixture" }));
  await waitFor(() => expect(mocks.setSubmitting).toHaveBeenLastCalledWith(false));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.setSystemTime(new Date(NOW * 1_000));
  mocks.account = {
    address: TEST_ACCOUNT,
    chainId: baseSepolia.id,
    isConnected: true,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.form = { ...validRevnetForm(), chainIds: [sepolia.id, baseSepolia.id] };
  mocks.formProps = {};
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account.chainId = chainId;
  });
  mocks.call.mockResolvedValue({ data: "0x" });
  // No finalized block is known, so a signed request counts as live.
  mocks.getBlock.mockResolvedValue({ hash: FINAL_HASH });
  mocks.readContract.mockImplementation(
    async ({
      functionName,
      address,
      clientChainId,
    }: {
      functionName: string;
      address: Address;
      clientChainId: number;
    }) =>
      functionName === "isTrustedForwarder"
        ? true
        : functionName === "eip712Domain"
          ? ["0x0f", "Juicebox", "1", BigInt(clientChainId), address, HASH, []]
          : 4n,
  );
  mocks.signTypedData.mockResolvedValue(`0x${"12".repeat(65)}` as Hex);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  relayrLaunches();
});

describe("unpaid Relayr launch quotes", () => {
  it("wallet-action:create-revnet rebuilds a stale-start launch only once every request of the stale one is dead, and never pays the stale one", async () => {
    const { activity, relayr, staleQuote } = await createPage();
    await submitLaunch();
    const stale = mocks.formProps.relayrResponse!;
    expect(stale.bundle_uuid).toBe(BUNDLE_UUID);

    // While the stale launch's requests can run, a second launch waits, saying until when.
    await submitLaunch();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/earlier signature can still run until/),
      }),
    );

    // The default start (quote time + 600 s) is now within 120 s. The rebuild
    // waits too: a different launch is never signed at the stale launch's nonces.
    vi.setSystemTime(new Date((NOW + 500) * 1_000));
    const rebuild = () =>
      staleQuote.ensureFreshQuote({
        bundle: stale,
        payment: stale.payment_info[0],
        quotedStageStart: mocks.formProps.quotedStageStart,
        rebuildStaleQuote: mocks.formProps.rebuildStaleQuote,
      });
    await expect(rebuild()).rejects.toThrow(/earlier signature can still run until/);
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);

    // Every request of the stale launch is dead and unused at a finalized block.
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    finalizedAt(PAST_DEADLINE);
    let fresh: Awaited<ReturnType<typeof staleQuote.ensureFreshQuote>> | undefined;
    await act(async () => {
      fresh = await rebuild();
    });
    expect(fresh?.bundle.bundle_uuid).toBe(OTHER_BUNDLE_UUID);
    expect(mocks.signTypedData).toHaveBeenCalledTimes(4);
    const rows = activity.transactionActivitySnapshot();
    expect(rows.find((row) => row.bundleUuid === BUNDLE_UUID)).toMatchObject({
      relayrDiscardable: "expired",
    });
    expect(rows.find((row) => row.bundleUuid === OTHER_BUNDLE_UUID)).toMatchObject({
      status: "pending",
      relayrPaymentStatus: "unfunded",
    });

    const payer = renderHook(() => relayr.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(stale.payment_info[0])).rejects.toThrow();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("never rebuilds a stale launch whose requests may have run", async () => {
    const { staleQuote } = await createPage();
    await submitLaunch();
    const stale = mocks.formProps.relayrResponse!;
    expect(mocks.signTypedData.mock.calls.map(([request]) => request.message.nonce)).toEqual([
      4n,
      4n,
    ]);
    // The stale launch's requests ran since: the forwarder's nonce moved on.
    mocks.readContract.mockImplementation(
      async ({ functionName, address }: { functionName: string; address: Address }) =>
        functionName === "isTrustedForwarder"
          ? true
          : functionName === "eip712Domain"
            ? ["0x0f", "Juicebox", "1", BigInt(mocks.account.chainId), address, HASH, []]
            : 5n,
    );
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    finalizedAt(PAST_DEADLINE);
    await expect(
      staleQuote.ensureFreshQuote({
        bundle: stale,
        payment: stale.payment_info[0],
        quotedStageStart: mocks.formProps.quotedStageStart,
        rebuildStaleQuote: mocks.formProps.rebuildStaleQuote,
      }),
    ).rejects.toThrow(/may already have run/);
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
  });

  it("lets the next launch through only once every request of the unpaid one is dead", async () => {
    await createPage();
    await submitLaunch();
    expect(mocks.formProps.relayrResponse?.bundle_uuid).toBe(BUNDLE_UUID);

    // The quote can no longer be paid, but its signatures can still run.
    vi.setSystemTime(new Date((FIRST_DEADLINE - 15) * 1_000));
    await submitLaunch();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/earlier signature can still run until/),
      }),
    );
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    finalizedAt(PAST_DEADLINE);
    mocks.toast.mockClear();
    await submitLaunch();
    expect(mocks.toast).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.formProps.relayrResponse?.bundle_uuid).toBe(OTHER_BUNDLE_UUID),
    );
    expect(mocks.signTypedData).toHaveBeenCalledTimes(4);
  });
});
