import { SafeQueueCard } from "@/app/[slug]/components/v6/operator/SafeQueueCard";
import { refreshTransactionActivities } from "@/lib/transaction-activity";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import { safeProposalFor, type SafeQueuedTransaction } from "@bananapus/nana-sdk-core/safe-service";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  provenSafe,
  queuedRow,
  SAFE_OWNER_A,
  safeChain,
  safeTransactionService,
} from "./fixtures/safe-chain";
import { groupGateState } from "./support/group-write-gate";

vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

const SAFE = provenSafe();
const OWNERS = SAFE.owners;
const TARGET = "0x4444444444444444444444444444444444444444" as Address;
const EXECUTION = `0x${"ef".repeat(32)}` as Hex;
const signature = (owner: Address) => `0x${owner.slice(2).padStart(128, "1")}1b` as Hex;

const mocks = vi.hoisted(() => ({
  client: undefined as unknown,
  execute: vi.fn(),
  deps: { adapter: { kind: "wallet", sendTransaction: vi.fn() } },
  connector: { id: "injected" } as unknown,
  address: "0x2222222222222222222222222222222222222222",
  receipt: vi.fn(),
  sign: vi.fn(),
  quote: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x2222222222222222222222222222222222222222", chainId: 8453 }),
  useConfig: () => ({}),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  publicClientFor: () => mocks.client,
  isLiveRevnetOperator: async () => true,
}));
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: (rows: { chainId: number }[]) => ({
    operatorByChain: new Map(rows.map((row) => [row.chainId, SAFE.address])),
    isLoading: false,
  }),
}));
vi.mock("@/lib/safe-connector", () => ({ useSafeConnection: () => false }));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
  useSafeTransactionSignature: () => ({ signSafeTransactionAsync: mocks.sign }),
  useReviewedAction: () => ({ deps: mocks.deps }),
  reviewedWalletAdapter: () => mocks.deps.adapter,
}));
vi.mock("wagmi/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi/actions")>()),
  getAccount: () => ({ connector: mocks.connector, address: mocks.address }),
}));
vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>()),
  executeReviewedSafeTransaction: mocks.execute,
}));
vi.mock("@/hooks/useReviewedRelayr", async (importOriginal) => ({
  RelayrRecoveryError: (await importOriginal<typeof import("@/hooks/useReviewedRelayr")>())
    .RelayrRecoveryError,
  checkRelayrSession: vi.fn(),
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: mocks.quote, reset: vi.fn() }),
  useSendRelayrTx: () => ({ sendRelayrTx: vi.fn() }),
  waitForRelayrBundle: vi.fn(),
}));
vi.mock("@/lib/waitForReceipt", () => ({ waitForReceiptWithRetry: mocks.receipt }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
// The real progress starts its review on open; here a test starts it, so it can change the
// listed transaction in between and reach the guards behind the hidden buttons.
vi.mock("@/components/ui/TxProgress", () => ({
  SummaryRow: ({ label, children }: { label: string; children: ReactNode }) => (
    <p>
      {label}: {children}
    </p>
  ),
  TxProgress: ({
    open,
    start,
    rows,
    children,
    error,
    footerContent,
  }: {
    open: boolean;
    start?: () => void;
    rows?: { label: string; value: ReactNode }[];
    children?: ReactNode;
    error?: string | null;
    footerContent?: ReactNode;
  }) =>
    open ? (
      <div role="dialog">
        {rows?.map((row) => (
          <p key={row.label}>
            {row.label}: {row.value}
          </p>
        ))}
        {children}
        {error ? <p role="alert">{error}</p> : null}
        {footerContent}
        {start ? <button onClick={start}>Start</button> : null}
      </div>
    ) : null,
}));

function renderCard(...chainIds: (8453 | 10 | 11155420)[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rows = chainIds.map((chainId) => ({ chainId, projectId: 42 }));
  render(
    <QueryClientProvider client={queryClient}>
      <SafeQueueCard rows={rows} fallbackProject={rows[0]!} />
    </QueryClientProvider>,
  );
  return queryClient;
}

/**
 * The listed transaction the card holds for `chainId`, as its review holds it: a test changes it
 * after the review opens to reach the guards behind the hidden buttons.
 */
function listedTransaction(queryClient: QueryClient, chainId: number) {
  const queries = queryClient.getQueryCache().findAll({ queryKey: ["revnet-safe-queues"] });
  const rows = queries.flatMap((query) => query.state.data ?? []) as {
    chainId: number;
    handleOnly: boolean;
    transactions: { transaction: SafeQueuedTransaction }[];
  }[];
  return rows.find((row) => row.chainId === chainId && !row.handleOnly)!.transactions[0]!
    .transaction;
}

/** Base's queue holds `tx` at the Safe's nonce, confirmed by both current owners. */
function baseQueue(tx: SafeQueuedTransaction) {
  const row = queuedRow(
    8453,
    SAFE.address,
    tx,
    OWNERS.map((owner) => ({ owner, signature: signature(owner) })),
  );
  const service = safeTransactionService("base", SAFE.address, [row]);
  vi.stubGlobal("fetch", service.fetch);
  return row;
}

beforeEach(() => {
  window.localStorage.clear();
  groupGateState.reset();
  mocks.client = safeChain(SAFE.address, { nonce: 5n }).client;
  mocks.execute.mockReset();
  mocks.execute.mockResolvedValue({
    status: "done",
    hashes: [EXECUTION],
    receipts: [{ status: "success", transactionHash: EXECUTION, blockNumber: 1n, logs: [] }],
  });
});

describe("Safe queue card", () => {
  it("wallet-action:safe-queue signs nothing for a row the sucker registry does not list", async () => {
    groupGateState.unverified = ["8453:42"];
    const row = queuedRow(8453, SAFE.address, safeProposalFor({ to: TARGET, data: "0x1234" }, 5), [
      { owner: OWNERS[1]!, signature: signature(OWNERS[1]!) },
    ]);
    vi.stubGlobal("fetch", safeTransactionService("base", SAFE.address, [row]).fetch);
    renderCard(8453);
    const sign = await screen.findByRole("button", { name: "Sign" });
    expect(screen.getByText("A project listed here isn't linked onchain.")).toBeTruthy();
    expect(sign).toBeDisabled();
    fireEvent.click(sign);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("wallet-action:safe-queue keeps a listed row's queue actionable beside an unlisted row with nothing queued", async () => {
    groupGateState.unverified = ["10:42"];
    const row = queuedRow(8453, SAFE.address, safeProposalFor({ to: TARGET, data: "0x1234" }, 5), [
      { owner: OWNERS[1]!, signature: signature(OWNERS[1]!) },
    ]);
    vi.stubGlobal("fetch", safeTransactionService("base", SAFE.address, [row]).fetch);
    renderCard(8453, 10);
    expect(await screen.findByRole("button", { name: "Sign" })).toBeEnabled();
    expect(screen.queryByText("A project listed here isn't linked onchain.")).toBeNull();
  });

  it("states in one line why the operator Safe's Ethereum handle queue can't be read", async () => {
    baseQueue(safeProposalFor({ to: TARGET, data: "0x1234" }, 5));
    renderCard(8453);

    expect(await screen.findByText("Ethereum handles")).toBeVisible();
    expect(
      await screen.findByText("Can't verify this Safe is the same on Ethereum.", { exact: true }),
    ).toBeVisible();
  });

  it("states in one line, and asks no service, where Safe hosts no transaction service", async () => {
    const service = vi.fn();
    vi.stubGlobal("fetch", service);
    renderCard(11155420);

    expect(
      await screen.findByText("Safe queue isn't available on Optimism Sepolia.", { exact: true }),
    ).toBeVisible();
    expect(screen.queryByText(/No pending transactions/)).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });

  it("refuses a queued transaction that pays a gas refund", async () => {
    baseQueue({ ...safeProposalFor({ to: TARGET, data: "0x1234" }, 5), gasPrice: "1" });
    renderCard(8453);

    expect(
      await screen.findByText("This transaction pays a gas refund, so it can't be executed here."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Execute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign" })).toBeNull();
  });

  it("counts only the current owners' confirmations", async () => {
    const row = queuedRow(8453, SAFE.address, safeProposalFor({ to: TARGET, data: "0x1234" }, 5), [
      { owner: SAFE_OWNER_A, signature: signature(SAFE_OWNER_A) },
      { owner: TARGET, signature: signature(TARGET) },
    ]);
    vi.stubGlobal("fetch", safeTransactionService("base", SAFE.address, [row]).fetch);
    renderCard(8453);

    expect(await screen.findByText(/1\/2 signatures/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Execute" })).toBeNull();
  });

  describe("executing a queued transaction from an owner's wallet", () => {
    async function execute() {
      const row = baseQueue(safeProposalFor({ to: TARGET, data: "0x1234" }, 5));
      renderCard(8453);
      fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Start" }),
      );
      await waitFor(() => expect(mocks.execute).toHaveBeenCalled());
      return row;
    }

    it("wallet-action:safe-queue executes the exact listed transaction through core, which confirms it by the Safe's ExecutionSuccess", async () => {
      const row = await execute();

      expect(mocks.execute).toHaveBeenCalledWith(
        {
          chainId: 8453,
          safe: SAFE.address,
          tx: expect.objectContaining({ safeTxHash: row.safeTxHash, nonce: 5 }),
          context: expect.arrayContaining([
            { label: "Safe transaction", value: "#5 on Base", strong: true },
          ]),
        },
        expect.objectContaining({ adapter: expect.objectContaining({ kind: "wallet" }) }),
      );
      expect(await screen.findByText("Executed Safe transaction #5 on Base.")).toBeVisible();
    });

    it("rechecks the queue, the wallet connection, its account and view-as at the wallet, and journals the send", async () => {
      await execute();
      const { adapter } = mocks.execute.mock.calls[0][1] as {
        adapter: { sendTransaction: (tx: unknown) => Promise<Hex> };
      };
      const tx = { chainId: 8453, to: SAFE.address, data: "0x6a76" as Hex, value: 0n };

      const reviewed = mocks.address;
      mocks.address = TARGET;
      await expect(adapter.sendTransaction(tx)).rejects.toThrow(
        "Wallet connection changed. Review the transaction again.",
      );
      mocks.address = reviewed;
      setViewAs(TARGET);
      await expect(adapter.sendTransaction(tx)).rejects.toThrow(/Exit View as/);
      clearViewAs();
      expect(mocks.deps.adapter.sendTransaction).not.toHaveBeenCalled();

      mocks.connector = { id: "other" };
      mocks.deps.adapter.sendTransaction.mockResolvedValue(EXECUTION);
      await expect(adapter.sendTransaction(tx)).resolves.toBe(EXECUTION);
      expect(refreshTransactionActivities()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ hash: EXECUTION, title: "Execute Safe transaction #5" }),
        ]),
      );
    });

    it("shows core's line, and claims nothing, when the execution is not confirmed", async () => {
      mocks.execute.mockRejectedValue(
        new Error("Your Safe's result for this could not be confirmed. Check it in Safe."),
      );
      await execute();

      expect(await screen.findByText(/could not be confirmed/)).toBeVisible();
      expect(screen.queryByText(/Executed Safe transaction/)).toBeNull();
    });
  });

  describe("refusing a transaction that pays a gas refund at every action", () => {
    const pays = (tx: SafeQueuedTransaction) => (tx.gasPrice = "1");

    it("in a signature", async () => {
      baseQueue(safeProposalFor({ to: TARGET, data: "0x1234" }, 5));
      // Only the other owner has signed, so this owner may sign.
      const row = queuedRow(
        8453,
        SAFE.address,
        safeProposalFor({ to: TARGET, data: "0x1234" }, 5),
        [{ owner: OWNERS[1]!, signature: signature(OWNERS[1]!) }],
      );
      vi.stubGlobal("fetch", safeTransactionService("base", SAFE.address, [row]).fetch);
      const queryClient = renderCard(8453);
      fireEvent.click(await screen.findByRole("button", { name: "Sign" }));
      const dialog = await screen.findByRole("dialog");
      pays(listedTransaction(queryClient, 8453));
      fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));

      expect(
        await within(dialog).findByText(
          "This transaction pays a gas refund, so it can't be executed here.",
        ),
      ).toBeVisible();
      expect(mocks.sign).not.toHaveBeenCalled();
    });

    it("in an execution", async () => {
      baseQueue(safeProposalFor({ to: TARGET, data: "0x1234" }, 5));
      const queryClient = renderCard(8453);
      fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
      const dialog = await screen.findByRole("dialog");
      pays(listedTransaction(queryClient, 8453));
      fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));

      expect(
        await within(dialog).findByText(
          "This transaction pays a gas refund, so it can't be executed here.",
        ),
      ).toBeVisible();
      expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("in Execute all", async () => {
      const ready = (chainId: number) =>
        queuedRow(
          chainId,
          SAFE.address,
          safeProposalFor({ to: TARGET, data: "0x1234" }, 5),
          OWNERS.map((owner) => ({ owner, signature: signature(owner) })),
        );
      const base = safeTransactionService("base", SAFE.address, [ready(8453)]);
      const optimism = safeTransactionService("oeth", SAFE.address, [ready(10)]);
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/v1/safe/oeth/")
          ? optimism.fetch(input, init)
          : base.fetch(input, init),
      );
      const queryClient = renderCard(8453, 10);
      const executeAll = await screen.findByRole("button", { name: "Execute 2 ready" });
      pays(listedTransaction(queryClient, 8453));
      fireEvent.click(executeAll);
      const dialog = await screen.findByRole("dialog");

      expect(
        await within(dialog).findByText(
          "This transaction pays a gas refund, so it can't be executed here.",
        ),
      ).toBeVisible();
      expect(mocks.quote).not.toHaveBeenCalled();
    });
  });
});
