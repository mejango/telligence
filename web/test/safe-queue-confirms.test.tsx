import { SafeQueueCard } from "@/app/[slug]/components/v6/operator/SafeQueueCard";
import { RelayrRecoveryError, type ReviewedRelayrRequest } from "@/hooks/useReviewedRelayr";
import {
  recordTransactionActivity,
  updateTransactionActivity,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import type {
  SafeRelayrProgress,
  SafeRelayrSession,
  SafeRelayrView,
} from "@bananapus/nana-sdk-core/review/safe-relayr";
import {
  safeProposalFor,
  safeQueueUrl,
  type SafeQueuedTransaction,
} from "@bananapus/nana-sdk-core/safe-service";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { zeroAddress, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  provenSafe,
  queuedRow,
  SAFE_OWNER_A,
  safeChain,
  safeTransactionService,
} from "./fixtures/safe-chain";
import { expectEveryWayOutRefused } from "./support/confirm";

vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

const SAFE = provenSafe();
const [, COSIGNER] = SAFE.owners as [Address, Address];
const TARGET = "0x4444444444444444444444444444444444444444" as Address;
const EXECUTION = `0x${"ef".repeat(32)}` as Hex;
const signature = (owner: Address) => `0x${owner.slice(2).padStart(128, "1")}1b` as Hex;

const mocks = vi.hoisted(() => ({
  address: undefined as string | undefined,
  client: undefined as unknown,
  /** The live operator check, the first read after each Confirm. */
  live: vi.fn(),
  sign: vi.fn(),
  write: vi.fn(),
  receipt: vi.fn(),
  quote: vi.fn(),
  pay: vi.fn(),
  bundle: vi.fn(),
  check: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.address, chainId: 8453 }),
  useConfig: () => ({}),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: (rows: { chainId: number }[]) => ({
    operatorByChain: new Map(rows.map((row) => [row.chainId, SAFE.address])),
    isLoading: false,
  }),
}));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  isLiveRevnetOperator: mocks.live,
  publicClientFor: () => mocks.client,
}));
vi.mock("@/lib/safe-connector", () => ({ useSafeConnection: () => false }));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
  useSafeTransactionSignature: () => ({ signSafeTransactionAsync: mocks.sign }),
  useReviewedAction: () => ({ deps: {} }),
}));
vi.mock("wagmi/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi/actions")>()),
  getAccount: () => ({ connector: undefined }),
}));
vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>()),
  executeReviewedSafeTransaction: mocks.write,
}));
vi.mock("@/hooks/useReviewedRelayr", async (importOriginal) => ({
  RelayrRecoveryError: (await importOriginal<typeof import("@/hooks/useReviewedRelayr")>())
    .RelayrRecoveryError,
  checkRelayrSession: mocks.check,
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: mocks.quote, reset: vi.fn() }),
  useSendRelayrTx: () => ({ sendRelayrTx: mocks.pay }),
  waitForRelayrBundle: mocks.bundle,
  watchSafeBundleView: mocks.watch,
}));
vi.mock("@/lib/transaction-review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transaction-review")>()),
  chooseRelayrPayment: async (payments: unknown[]) => payments[0],
}));
vi.mock("@/lib/waitForReceipt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/waitForReceipt")>()),
  waitForReceiptWithRetry: mocks.receipt,
}));

/** `chainId`'s queued call at the Safe's nonce 5, confirmed by `signers`. */
function queued(chainId: number, signers: Address[]): SafeQueuedTransaction {
  return queuedRow(
    chainId,
    SAFE.address,
    safeProposalFor({ to: TARGET, data: "0x1234" }, 5),
    signers.map((owner) => ({ owner, signature: signature(owner) })),
  );
}

/** Safe's transaction service on Base (and on Optimism when given) lists these rows. */
function serveQueues(base: SafeQueuedTransaction, optimism?: SafeQueuedTransaction) {
  const onBase = safeTransactionService("base", SAFE.address, [base]);
  const onOptimism = safeTransactionService("oeth", SAFE.address, optimism ? [optimism] : []);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("/v1/safe/oeth/")
      ? onOptimism.fetch(input, init)
      : onBase.fetch(input, init),
  );
  return onBase;
}

function renderCard(...chainIds: (8453 | 10)[]) {
  const rows = chainIds.map((chainId) => ({ chainId, projectId: 4 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <SafeQueueCard rows={rows} fallbackProject={rows[0]!} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}

/** Holds the next live operator check, the first read each send makes after Confirm. */
function holdLiveRead() {
  let answer!: () => void;
  mocks.live.mockReturnValue(new Promise<boolean>((resolve) => (answer = () => resolve(true))));
  return () => act(async () => answer());
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.address = SAFE_OWNER_A;
  mocks.client = {
    ...(safeChain(SAFE.address, { nonce: 5n }).client as object),
    estimateGas: async () => 100_000n,
  };
  mocks.live.mockReset().mockResolvedValue(true);
  mocks.sign.mockReset().mockResolvedValue(`0x${"9".repeat(130)}`);
  mocks.write.mockReset().mockResolvedValue({
    status: "done",
    hashes: [EXECUTION],
    receipts: [{ status: "success", transactionHash: EXECUTION, blockNumber: 1n, logs: [] }],
  });
  mocks.receipt.mockReset();
  mocks.quote.mockReset().mockResolvedValue({
    bundle_uuid: "bundle-1",
    payment_info: [{ chain: 8453, amount: "1000", token: zeroAddress }],
  });
  mocks.pay.mockReset().mockResolvedValue(EXECUTION);
  mocks.bundle.mockReset().mockResolvedValue(undefined);
  mocks.check.mockReset().mockResolvedValue(undefined);
  mocks.watch.mockReset().mockReturnValue(() => undefined);
});

describe("the Safe queue's signature confirm", () => {
  async function openSign() {
    const service = serveQueues(queued(8453, [COSIGNER]));
    renderCard(8453);
    const sign = await screen.findByRole("button", { name: "Sign" });
    const release = holdLiveRead();
    fireEvent.click(sign);
    const confirm = await screen.findByRole("dialog", { name: "Confirm signature" });
    return { confirm, service, release };
  }

  it("wallet-action:safe-queue refuses every way out from Confirm through the reads before the wallet prompt, then closes once signed", async () => {
    const { confirm, service, release } = await openSign();
    await waitFor(() => expect(mocks.live).toHaveBeenCalled());

    expectEveryWayOutRefused(confirm);
    expect(mocks.sign).not.toHaveBeenCalled();

    await release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(service.posts).toHaveLength(1);
    expect(screen.getByText("Signed Safe transaction #5 on Base.")).toBeInTheDocument();
  });
});

describe("the Safe queue's execution confirm", () => {
  async function openExecute(before?: () => void) {
    const row = queued(8453, SAFE.owners);
    serveQueues(row);
    renderCard(8453);
    const execute = await screen.findByRole("button", { name: "Execute" });
    before?.();
    fireEvent.click(execute);
    return screen.findByRole("dialog", { name: "Confirm execution" });
  }

  it("waits for a wallet before it opens", async () => {
    mocks.address = undefined;
    serveQueues(queued(8453, SAFE.owners));
    renderCard(8453);

    expect(await screen.findByRole("button", { name: "Execute" })).toBeDisabled();
  });

  it("does not authorize execution from the cached display identity when the fresh identity check fails", async () => {
    const unavailable = safeChain(SAFE.address, { nonce: 5n });
    unavailable.getCode.mockRejectedValue(new Error("RPC temporarily unavailable"));
    const confirm = await openExecute(() => (mocks.client = unavailable.client));

    expect(
      await within(confirm).findByText(
        "The operator no longer has a supported canonical Safe identity.",
      ),
    ).toBeVisible();
    expect(unavailable.getCode).toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("wallet-action:safe-queue refuses every way out from Confirm through the reads before the wallet prompt, then closes once executed", async () => {
    let release!: () => Promise<void>;
    const confirm = await openExecute(() => (release = holdLiveRead()));
    await waitFor(() => expect(mocks.live).toHaveBeenCalled());

    expectEveryWayOutRefused(confirm);
    expect(mocks.write).not.toHaveBeenCalled();

    await release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ chainId: 8453, safe: SAFE.address });
    expect(screen.getByText("Executed Safe transaction #5 on Base.")).toBeInTheDocument();
  });
});

describe("the Safe queue's execute-all confirm", () => {
  function lostQuote() {
    const activity: TransactionActivity = {
      id: "lost-response",
      kind: "relayr-bundle",
      title: "Safe execution bundle",
      status: "pending",
      message: "Quote response lost.",
      account: SAFE_OWNER_A,
      relayrPaymentStatus: "unfunded",
      createdAt: 1,
      updatedAt: 1,
      relayrExpectedTransactions: [1, 8453].map((chainId) => ({
        chainId,
        target: SAFE.address,
        data: "0x",
        value: "0",
        gas: "100000",
        transactionUuid: "",
        expectedSafeExecution: { safe: SAFE.address, safeTxHash: EXECUTION, nonce: 4 },
      })),
    };
    recordTransactionActivity(activity);
    return activity;
  }

  async function openBatch(beforeOpen?: () => void) {
    serveQueues(queued(8453, SAFE.owners), queued(10, SAFE.owners));
    renderCard(8453, 10);
    const executeAll = await screen.findByRole("button", { name: "Execute 2 ready" });
    beforeOpen?.();
    fireEvent.click(executeAll);
    return screen.findByRole("dialog", { name: "Execute 2 Safe transactions" });
  }

  it("starts checks on open but cancels without quoting or paying while checks are pending", async () => {
    let release!: ReturnType<typeof holdLiveRead>;
    const confirm = await openBatch(() => {
      release = holdLiveRead();
    });
    await waitFor(() => expect(mocks.live).toHaveBeenCalled());
    expect(
      within(confirm)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Close"]);
    expect(within(confirm).queryByRole("combobox")).toBeNull();
    expect(within(confirm).getAllByText("Checking…")).toHaveLength(2);
    expect(
      within(confirm)
        .getAllByRole("status")
        .map((status) => status.textContent),
    ).toEqual(["Base: Checking…", "Optimism: Checking…", "Checking the Safe transactions…"]);
    fireEvent.click(within(confirm).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await release();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("keeps fee selection in the footer after the reviewed steps and waits for explicit payment", async () => {
    const payments = [
      { chain: 8453, amount: "1000", token: zeroAddress },
      { chain: 10, amount: "2000", token: zeroAddress },
    ];
    mocks.quote.mockResolvedValue({ bundle_uuid: "bundle-1", payment_info: payments });
    const confirm = await openBatch();
    const pay = await within(confirm).findByRole("button", { name: "Pay" });
    expect(pay).toBeEnabled();
    expect(mocks.quote).toHaveBeenCalledOnce();
    const fee = within(confirm).getByRole("combobox", { name: "Pay network fee on" });
    const footer = confirm.querySelector("footer")!;
    expect(footer).toContainElement(fee);
    expect(footer).toContainElement(pay);
    expect(
      within(confirm).getByRole("list").compareDocumentPosition(fee) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(fee.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fee).toHaveValue("8453");
    fireEvent.change(fee, { target: { value: "10" } });
    expect(mocks.pay).not.toHaveBeenCalled();

    fireEvent.click(pay);

    await waitFor(() =>
      expect(mocks.pay).toHaveBeenCalledWith(
        payments[1],
        expect.objectContaining({ onStatus: expect.any(Function) }),
      ),
    );
    expect(mocks.pay).toHaveBeenCalledOnce();
  });

  it("changes review copy to requesting a quote immediately after acceptance while Relayr is pending", async () => {
    let acceptReview!: () => void;
    let finishQuote!: (quote: unknown) => void;
    mocks.quote.mockImplementation(
      async (
        _requests: unknown,
        options: { onProgress?: (progress: SafeRelayrProgress) => void },
      ) => {
        await new Promise<void>((resolve) => (acceptReview = resolve));
        options.onProgress?.({ type: "phase", phase: "quoting" });
        return new Promise((resolve) => (finishQuote = resolve));
      },
    );
    const confirm = await openBatch();
    await waitFor(() => expect(mocks.quote).toHaveBeenCalledOnce());
    expect(
      within(confirm).getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === "Review the executions to get payment options…",
      ),
    ).toBeVisible();
    expect(within(confirm).getAllByRole("button")).toHaveLength(1);
    expect(within(confirm).getByRole("button", { name: "Close" })).toBeEnabled();
    expect(within(confirm).queryByRole("combobox")).toBeNull();
    expect(mocks.pay).not.toHaveBeenCalled();

    await act(async () => acceptReview());

    expect(within(confirm).getAllByRole("button")).toHaveLength(1);
    expect(
      within(confirm).getByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent === "Getting payment options…",
        { selector: "p" },
      ),
    ).toBeVisible();
    expect(confirm).not.toHaveTextContent(/Relayr/i);
    expect(within(confirm).queryByText(/Review the executions/)).toBeNull();
    expect(within(confirm).queryByRole("button", { name: /^Pay$/ })).toBeNull();
    expect(within(confirm).queryByRole("combobox")).toBeNull();
    expect(mocks.pay).not.toHaveBeenCalled();

    await act(async () =>
      finishQuote({
        bundle_uuid: "reviewed",
        payment_info: [{ chain: 8453, amount: "1000", token: zeroAddress }],
      }),
    );
    expect(await within(confirm).findByRole("button", { name: "Pay" })).toBeEnabled();
    expect(within(confirm).getByRole("combobox", { name: "Pay network fee on" })).toBeVisible();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("ignores a quote that returns after the user closes preparation", async () => {
    let finish!: (quote: unknown) => void;
    let lateProgress: ((progress: SafeRelayrProgress) => void) | undefined;
    mocks.quote.mockImplementation(
      (_requests: unknown, options: { onProgress?: (progress: SafeRelayrProgress) => void }) => {
        lateProgress = options.onProgress;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    const confirm = await openBatch();
    await waitFor(() => expect(mocks.quote).toHaveBeenCalledOnce());
    fireEvent.click(within(confirm).getByRole("button", { name: "Close" }));
    await act(async () => lateProgress?.({ type: "phase", phase: "quoting" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () =>
      finish({
        bundle_uuid: "late",
        payment_info: [{ chain: 8453, amount: "1000", token: zeroAddress }],
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("allows retrying failed checks without a wallet request", async () => {
    mocks.quote.mockRejectedValueOnce(new Error("Quote temporarily unavailable"));
    const confirm = await openBatch();
    fireEvent.click(await within(confirm).findByRole("button", { name: "Retry checks" }));
    await within(confirm).findByRole("button", { name: "Pay" });
    expect(mocks.quote).toHaveBeenCalledTimes(2);
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("shows the chain and simulation failure without service branding or a payment claim", async () => {
    const cause = Object.freeze({ status: 406, body: { error: "SimulationReverted", chain: 1 } });
    const failure = Object.freeze(
      new Error("Relayr HTTP 406: SimulationReverted on chain 1: GS013", { cause }),
    );
    mocks.quote.mockRejectedValueOnce(failure);
    const confirm = await openBatch();
    expect(
      await within(confirm).findByText("Transaction simulation failed on chain 1: GS013"),
    ).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Retry checks" })).toBeEnabled();
    expect(confirm).not.toHaveTextContent(/Relayr|nothing was (?:sent|paid)|no payment was sent/i);
    expect(failure.message).toBe("Relayr HTTP 406: SimulationReverted on chain 1: GS013");
    expect(failure.cause).toBe(cause);
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("invalidates a prepared quote when the connected account changes", async () => {
    serveQueues(queued(8453, SAFE.owners), queued(10, SAFE.owners));
    const view = renderCard(8453, 10);
    fireEvent.click(await screen.findByRole("button", { name: "Execute 2 ready" }));
    const confirm = await screen.findByRole("dialog", { name: "Execute 2 Safe transactions" });
    await within(confirm).findByRole("button", { name: "Pay" });
    mocks.address = COSIGNER;
    view.refresh();
    await waitFor(() => expect(within(confirm).queryByRole("button", { name: "Pay" })).toBeNull());
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(within(confirm).getByText(/account changed/i)).toBeVisible();
  });

  it("offers read-only recovery instead of repeating quote creation for a reserved bundle", async () => {
    const activity: TransactionActivity = {
      id: "existing",
      kind: "relayr-bundle",
      title: "Saved Safe executions",
      status: "pending",
      message: "An unpaid quote is still payable.",
      account: SAFE_OWNER_A,
      bundleUuid: "saved-bundle",
      relayrPaymentStatus: "unfunded",
      createdAt: 1,
      updatedAt: 1,
    };
    recordTransactionActivity(activity);
    mocks.quote.mockRejectedValue(new RelayrRecoveryError(activity));
    const confirm = await openBatch();
    const check = await within(confirm).findByRole("button", { name: "Check status" });
    expect(within(confirm).queryByRole("button", { name: "Retry checks" })).toBeNull();
    expect(within(confirm).getByText("saved-bundle")).toBeVisible();
    fireEvent.click(check);
    await waitFor(() =>
      expect(mocks.check).toHaveBeenCalledWith("existing", expect.any(AbortSignal)),
    );
    await within(confirm).findByText("An unpaid quote is still payable.");
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.pay).not.toHaveBeenCalled();
    mocks.check.mockImplementationOnce(async () => {
      updateTransactionActivity("existing", { relayrPaymentStatus: "expired" });
    });
    mocks.quote.mockResolvedValue({
      bundle_uuid: "fresh",
      payment_info: [{ chain: 8453, amount: "1000", token: zeroAddress }],
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Check status" }));
    await within(confirm).findByRole("button", { name: "Pay" });
    expect(mocks.quote).toHaveBeenCalledTimes(2);
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("shows the saved selection's Safe links and visible nonce check results when a quote response is missing", async () => {
    const activity = lostQuote();
    const initial = {
      reason: "safe-nonces-unavailable" as const,
      message: "The saved Safe nonce could not be checked. Its recovery record remains reserved.",
      checks: [{ chainId: 1, safe: SAFE.address, nonce: 4, state: "unavailable" as const }],
    };
    mocks.quote.mockRejectedValue(new RelayrRecoveryError(activity, initial));
    const confirm = await openBatch();
    const check = await within(confirm).findByRole("button", { name: "Check Safe nonces" });
    expect(within(confirm).getByText(initial.message)).toBeVisible();
    const links = within(confirm).getAllByRole("link", { name: "Open in Safe ↗" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      safeQueueUrl(1, SAFE.address),
      safeQueueUrl(8453, SAFE.address),
    ]);
    expect(within(confirm).getByText("Check unavailable.")).toBeVisible();
    let finish!: (value: unknown) => void;
    mocks.check.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(check);
    expect(within(confirm).queryByRole("button", { name: "Checking…" })).toBeNull();
    expect(within(confirm).getByRole("button", { name: "Close" })).toBeEnabled();
    const message =
      "One saved Safe nonce is still pending. The original recovery record remains reserved.";
    await act(async () =>
      finish({
        state: "pending",
        recovery: {
          reason: "safe-nonces-mixed",
          message,
          checks: [
            { chainId: 1, safe: SAFE.address, nonce: 4, state: "consumed", currentNonce: "5" },
            { chainId: 8453, safe: SAFE.address, nonce: 4, state: "live", currentNonce: "4" },
          ],
        },
      }),
    );
    expect(within(confirm).getByText(message)).toBeVisible();
    expect(within(confirm).getByText("No longer pending.")).toBeVisible();
    expect(within(confirm).getByText("Still pending.")).toBeVisible();
    expect(mocks.check).toHaveBeenCalledWith(activity.id, expect.any(AbortSignal));
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("refreshes the queue after all saved Safe nonces are consumed without preparing the obsolete selection again", async () => {
    const activity = lostQuote();
    mocks.quote.mockRejectedValue(new RelayrRecoveryError(activity));
    const confirm = await openBatch();
    const check = await within(confirm).findByRole("button", { name: "Check Safe nonces" });
    const readsBeforeCheck = mocks.live.mock.calls.length;
    mocks.check.mockResolvedValueOnce({
      state: "released",
      session: { releaseReason: "safe-nonces-consumed" },
    });
    fireEvent.click(check);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByText(
        "The saved Safe transactions are no longer pending. The Safe queue has been refreshed.",
      ),
    ).toBeVisible();
    await waitFor(() => expect(mocks.live.mock.calls.length).toBeGreaterThan(readsBeforeCheck));
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("also refreshes when initial preparation discovers an obsolete saved selection", async () => {
    const activity = {
      ...lostQuote(),
      relayrSafeState: "released" as const,
      relayrSafeReleaseReason: "safe-nonces-consumed" as const,
    };
    mocks.quote.mockRejectedValue(
      new RelayrRecoveryError(activity, {
        reason: "safe-nonces-consumed",
        message: "These saved Safe nonces have advanced.",
      }),
    );
    await openBatch();
    await screen.findByText(
      "The saved Safe transactions are no longer pending. The Safe queue has been refreshed.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("shows payment confirmation and each chain's verified progress while the bundle is still running", async () => {
    const confirm = await openBatch();
    const pay = await within(confirm).findByRole("button", { name: "Pay" });
    const requests = mocks.quote.mock.calls[0][0] as ReviewedRelayrRequest[];
    const session: SafeRelayrSession = {
      id: "progress-session",
      account: SAFE_OWNER_A,
      bundleUuid: "bundle-1",
      executions: requests.map((request) => ({
        ...request.expectedSafeExecution!,
        entry: {
          chain: request.chainId,
          target: request.data.to,
          data: request.data.data,
          value: request.data.value.toString(),
        },
      })),
      paymentStatus: "submitted",
      payments: [],
      state: "active",
      createdAt: 1,
    };
    let show!: (view: SafeRelayrView) => void;
    mocks.watch.mockImplementation(
      (_config: unknown, _activityId: string, listener: (view: SafeRelayrView) => void) => {
        show = listener;
        return () => undefined;
      },
    );
    let view: SafeRelayrView = {
      phase: null,
      checks: {},
      executions: {},
      result: null,
      running: "fund",
      session: null,
      error: null,
    };
    const next = (patch: Partial<SafeRelayrView>) => {
      view = { ...view, ...patch };
      show(view);
    };
    let finishPayment!: () => void;
    mocks.pay.mockImplementation(
      () => new Promise((resolve) => (finishPayment = () => resolve(EXECUTION))),
    );
    let finishWatch!: () => void;
    mocks.bundle.mockImplementation(() => new Promise<void>((resolve) => (finishWatch = resolve)));
    fireEvent.click(pay);
    await waitFor(() => expect(mocks.pay).toHaveBeenCalledOnce());
    expect(mocks.watch).toHaveBeenCalledWith(
      expect.anything(),
      "relayr:bundle-1",
      expect.any(Function),
    );

    const unpaid = { ...session, paymentStatus: "unfunded" as const };
    await act(async () => next({ phase: "payment-review", session: unpaid }));
    expect(
      within(confirm).getByText(
        (_, element) => element?.tagName === "P" && element.textContent === "Preparing payment…",
        { selector: "p" },
      ),
    ).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Preparing payment…" })).toBeDisabled();
    await act(async () => next({ phase: "payment-checking", session: unpaid }));
    expect(
      within(confirm).getByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent === "Checking before payment…",
      ),
    ).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(within(confirm).queryByText("Review the network fee…")).toBeNull();
    expect(within(confirm).queryByRole("button", { name: "Pay" })).toBeNull();

    await act(async () => next({ phase: "payment-confirming", session }));

    expect(
      within(confirm).getByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent === "Waiting for the payment to confirm…",
      ),
    ).toBeVisible();
    expect(within(confirm).getAllByText("Checking payment status…")).toHaveLength(2);
    expect(within(confirm).getByRole("button", { name: "Confirming payment…" })).toBeDisabled();
    expect(within(confirm).queryByText("Ready", { exact: true })).toBeNull();
    expect(within(confirm).queryByText("Confirm the payment in your wallet…")).toBeNull();
    expect(within(confirm).queryByRole("button", { name: /^Pay$/ })).toBeNull();
    expect(mocks.bundle).not.toHaveBeenCalled();

    for (const paymentStatus of ["sending", "submitted"] as const) {
      await act(async () =>
        next({
          session: { ...session, paymentStatus },
          executions: { ...view.executions, 0: { status: "pending" } },
        }),
      );
      expect(within(confirm).getAllByText("Checking payment status…")).toHaveLength(2);
      expect(within(confirm).queryByText("Waiting for payment")).toBeNull();
    }

    await act(async () => finishPayment());
    await waitFor(() => expect(mocks.bundle).toHaveBeenCalledWith("bundle-1"));
    const optimismHash = `0x${"ab".repeat(32)}` as Hex;
    await act(async () => {
      next({ phase: "executing", session });
      next({ executions: { ...view.executions, 0: { status: "confirming", hash: EXECUTION } } });
      next({ executions: { ...view.executions, 1: { status: "executed", hash: optimismHash } } });
    });

    const [base, optimism] = within(confirm).getAllByRole("listitem");
    expect(base).toHaveTextContent("Base #5");
    expect(within(base).getByText("Confirming", { exact: true })).toBeVisible();
    expect(within(base).getByRole("link", { name: "View transaction ↗" })).toHaveAttribute(
      "href",
      `https://basescan.org/tx/${EXECUTION}`,
    );
    expect(optimism).toHaveTextContent("Optimism #5");
    expect(within(optimism).getByText("Executed", { exact: true })).toBeVisible();
    expect(within(optimism).getByRole("link", { name: "View transaction ↗" })).toHaveAttribute(
      "href",
      `https://optimistic.etherscan.io/tx/${optimismHash}`,
    );
    expect(within(confirm).getByRole("button", { name: "Executing…" })).toBeDisabled();
    expect(within(confirm).queryByText("Ready", { exact: true })).toBeNull();
    expect(within(confirm).queryByText("Confirm the payment in your wallet…")).toBeNull();
    expect(within(confirm).queryByRole("button", { name: /^(Pay|Done)$/ })).toBeNull();

    await act(async () => finishWatch());
    expect(await within(confirm).findByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("recovers a submitted payment with Check status instead of offering another payment", async () => {
    const confirm = await openBatch();
    const pay = await within(confirm).findByRole("button", { name: "Pay" });
    const activity: TransactionActivity = {
      id: "submitted-payment",
      kind: "relayr-bundle",
      title: "Saved Safe executions",
      status: "pending",
      message: "The submitted Relayr payment is still awaiting confirmation.",
      account: SAFE_OWNER_A,
      chainId: 8453,
      hash: EXECUTION,
      bundleUuid: "bundle-1",
      relayrPaymentStatus: "submitted",
      relayrSafeState: "active",
      createdAt: 1,
      updatedAt: 1,
    };
    mocks.pay.mockImplementation(async () => {
      recordTransactionActivity(activity);
      throw new RelayrRecoveryError(activity);
    });

    fireEvent.click(pay);

    const check = await within(confirm).findByRole("button", { name: "Check status" });
    expect(check).toBeEnabled();
    expect(within(confirm).queryByRole("button", { name: /^Pay$/ })).toBeNull();
    expect(within(confirm).queryByRole("combobox", { name: "Pay network fee on" })).toBeNull();
    expect(within(confirm).queryByText("Confirm the payment in your wallet…")).toBeNull();
    expect(within(confirm).getByText(/already has a submitted payment/)).toBeVisible();

    fireEvent.click(check);

    await waitFor(() =>
      expect(mocks.check).toHaveBeenCalledWith(activity.id, expect.any(AbortSignal)),
    );
    expect(
      await within(confirm).findByText("The submitted payment is still awaiting confirmation."),
    ).toBeVisible();
    expect(confirm).not.toHaveTextContent(/Relayr/i);
    expect(activity.message).toContain("Relayr payment");
    expect(mocks.pay).toHaveBeenCalledOnce();
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(within(confirm).queryByRole("button", { name: /^Pay$/ })).toBeNull();
  });

  it("refuses every way out during payment, then ends on Done", async () => {
    const confirm = await openBatch();
    const pay = await within(confirm).findByRole("button", { name: "Pay" });
    let release!: () => void;
    mocks.pay.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(EXECUTION);
      }),
    );
    fireEvent.click(pay);
    await waitFor(() => expect(mocks.pay).toHaveBeenCalledOnce());
    expectEveryWayOutRefused(confirm);
    await act(async () => release());
    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("Executed 2 Safe transactions.");
    expect(within(confirm).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(confirm).queryByRole("button", { name: /^Pay$/ })).toBeNull();
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
