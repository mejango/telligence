import { PendingRoutingPayments } from "@/app/[slug]/components/ActivityFeed/PendingRoutingPayments";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  indexed: vi.fn(),
  payment: vi.fn(),
  prepare: vi.fn(),
  batch: vi.fn(),
  saved: vi.fn(),
  recheck: vi.fn(),
  describe: vi.fn(),
  names: vi.fn(),
  address: "0x0000000000000000000000000000000000000001",
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address, chainId: 1 }) }));
vi.mock("@/lib/bendystraw/client", () => ({
  queryBendystrawFromBrowser: mocks.names,
}));
vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: () => ({}) }));
vi.mock("@/hooks/useMultichainBatch", () => ({
  useMultichainBatch: () => ({
    runBatch: mocks.batch,
    getPendingBatch: mocks.saved,
    recheckPendingRoutingBatch: mocks.recheck,
  }),
}));
vi.mock("@/lib/pending-router-calls", () => ({
  readIndexedPendingRouterCalls: mocks.indexed,
  readPendingRouterPayment: mocks.payment,
  preparePendingRouterPayment: mocks.prepare,
  describeSavedRoutingCall: mocks.describe,
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    onClick,
    disabled,
    loading,
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    "aria-label"?: string;
  }) => (
    <button aria-label={ariaLabel} onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
}));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  formatWalletError: (cause: Error) => cause.message,
}));

const projects = [
  { chainId: 1, projectId: 1, version: 6 },
  { chainId: 8453, projectId: 1, version: 6 },
];
const row = (id: string, ready = true) => ({
  id,
  ready,
  amountLabel: "0.1 ETH",
  action: "processPendingCall",
  nextAttemptAt: 86_500n,
  indexed: {
    chainId: id === "base" ? 8453 : 1,
    sourceProjectId: 7,
    projectId: 1,
    beneficiary: mocks.address,
    refundTo: mocks.address,
    pendingCallId: id,
  },
});
function setup(expanded = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <PendingRoutingPayments projects={projects} />
    </QueryClientProvider>,
  );
  const details = rendered.container.querySelector("details");
  if (details && expanded) details.open = true;
  return rendered;
}
beforeEach(() => {
  mocks.names.mockResolvedValue({ project: null });
  mocks.address = "0x0000000000000000000000000000000000000001";
  mocks.saved.mockReturnValue(undefined);
  mocks.recheck.mockImplementation(async () => mocks.saved());
  mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
    project.chainId === 1 ? [row("one").indexed] : [],
  );
  mocks.payment.mockImplementation(async (_client, indexed) => row(indexed.pendingCallId));
  mocks.prepare.mockImplementation(async (_client, indexed) => ({
    payment: row(indexed.pendingCallId),
    call: { id: indexed.pendingCallId },
  }));
  mocks.batch.mockResolvedValue({ status: "success", hashes: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Holds every payment preparation until released, so the journal can change mid-review. */
function holdPreparation() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const prepare = mocks.prepare.getMockImplementation()!;
  mocks.prepare.mockImplementation(async (...args: Parameters<typeof prepare>) => {
    await gate;
    return prepare(...args);
  });
  return () => act(async () => release());
}

/** A newer journal entry, written while the review was open. */
const NEWER_JOURNAL = { id: "different", scope: "other", completed: 0, total: 1 };

describe("payment recovery", () => {
  it("starts collapsed and hides raw amounts until payment details are verified", async () => {
    let resolve!: (value: ReturnType<typeof row>) => void;
    mocks.payment.mockReturnValue(
      new Promise((finish) => {
        resolve = finish;
      }),
    );
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1
        ? [{ ...row("one").indexed, amount: "42500018", token: mocks.address }]
        : [],
    );
    const rendered = setup(false);
    const summary = await screen.findByText("1 payment needs processing.");
    const details = rendered.container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(rendered.container.textContent).not.toContain("42500018");
    expect(rendered.container.textContent).not.toContain("base units");
    expect(rendered.container.textContent).toContain("Checking payment amount");
    expect(screen.getByRole("button", { name: "Checking payment" })).toBeDisabled();
    await act(async () => resolve(row("one")));
    expect(await screen.findByText("0.1 ETH")).toBeTruthy();
  });

  it("resolves source and destination names using their exact chain and project", async () => {
    mocks.names.mockImplementation(async (_operation, ref) => ({
      project: {
        projectId: ref.projectId,
        version: 6,
        name: ref.projectId === 7 ? "Source business" : "Destination business",
      },
    }));
    setup();
    await screen.findByText("To Destination business on Ethereum");
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Retry payments" });
    expect(within(dialog).getByText("Source business")).toBeTruthy();
    expect(within(dialog).getByText("Destination business")).toBeTruthy();
    expect(mocks.names).toHaveBeenCalledWith(
      expect.anything(),
      { chainId: 1, projectId: 7, version: 6 },
      1,
    );
  });

  it.each(["uncertain", "pending"])(
    "continues the saved submission after a %s result without fresh routing confirmation",
    async (outcome) => {
      const hash = `0x${"a".repeat(64)}`;
      const message = `Payment ${hash} was submitted, but confirmation is uncertain. Do not pay again.`;
      const saved = {
        id: "submitted-batch",
        scope: "pending-routing:destination:1:1,8453:1",
        completed: 0,
        total: 1,
        calls: [],
        recoveryReason: "Checking the submitted payment.",
      };
      mocks.batch.mockImplementationOnce(async () => {
        mocks.saved.mockReturnValue(saved);
        if (outcome === "uncertain") throw new Error(message);
        return { status: "pending", hashes: [] };
      });
      setup();
      fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
      const dialog = await screen.findByRole("dialog");
      const resume = await within(dialog).findByRole("button", { name: "Try again" });
      expect(within(dialog).queryByRole("button", { name: "Retry" })).toBeNull();
      expect(within(dialog).queryByRole("button", { name: "Done" })).toBeNull();
      if (outcome === "uncertain") {
        expect(within(dialog).getByRole("alert")).toHaveTextContent(message);
        expect(within(dialog).getByRole("alert")).toHaveClass("wrap-anywhere");
      }
      fireEvent.click(resume);
      await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
      expect(mocks.batch.mock.calls[1][0]).toMatchObject({
        scope: saved.scope,
        expectedBatchId: saved.id,
        calls: [],
      });
      expect(mocks.prepare).toHaveBeenCalledTimes(1);
    },
  );

  it("renders nothing when all indexed destination projects have no pending calls", async () => {
    mocks.indexed.mockResolvedValue([]);
    setup();
    await waitFor(() => expect(mocks.indexed).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("payments need processing.")).toBeNull());
  });

  it("offers a per-payment review with the original beneficiary and no settlement claim", async () => {
    setup();
    expect(await screen.findByText("1 payment ready to retry.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/may stay pending/)).toBeTruthy();
    expect(screen.getByText("Beneficiary")).toBeTruthy();
    await screen.findByText(/Routing review complete/);
    expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({ calls: [{ id: "one" }] }));
  });

  it("wallet-action:pending-routing batches every ready payment across chains and explicitly leaves cooldown calls pending", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? [row("one").indexed, row("waiting").indexed] : [row("base").indexed],
    );
    mocks.payment.mockImplementation(async (_client, indexed) =>
      row(indexed.pendingCallId, indexed.pendingCallId !== "waiting"),
    );
    setup();
    expect(await screen.findByText("2 of 3 payments ready to retry.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Retry all payments" }));
    expect(screen.getByText("Payments in cooldown must wait.")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(
        expect.objectContaining({ calls: [{ id: "one" }, { id: "base" }] }),
      ),
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  it("reviews all 14 ready payments and offers normal confirmation despite a hashless three-attempt selection", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown-three",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
      recoveryReason: "A wallet submission has an unknown result.",
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    const rendered = setup();
    await screen.findByText("14 payments ready to retry.");
    expect(screen.queryByRole("button", { name: "Resume saved batch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-check saved status" })).toBeNull();
    expect(screen.queryByText(/Saved batch:/)).toBeNull();
    expect(screen.queryByText(/A wallet submission has an unknown result/)).toBeNull();
    expect(mocks.recheck).not.toHaveBeenCalled();
    const release = holdPreparation();
    fireEvent.click(screen.getByRole("button", { name: "Retry all payments" }));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalled());

    // The eventual write must recheck the reviewed ID, never silently supersede a newer journal.
    mocks.saved.mockReturnValue({ ...NEWER_JOURNAL, refreshable: true });
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PendingRoutingPayments projects={projects} />
      </QueryClientProvider>,
    );
    await release();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(14);
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).queryByText(/Check your wallet has no pending transaction/)).toBeNull();
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    expect(mocks.batch.mock.calls[0][0]).toMatchObject({
      scope: "pending-routing:destination:1:1,8453:1",
      refreshBatchId: "unknown-three",
      calls: Array.from({ length: 14 }, (_, i) => ({ id: `item-${i}` })),
    });
    expect(mocks.batch.mock.calls[0][0].replaceDraftId).toBeUndefined();
    expect(mocks.batch.mock.calls[0][0].expectedBatchId).toBeUndefined();
    expect(mocks.prepare).toHaveBeenCalledTimes(14);
  });

  it("cancels a fresh review without changing the saved batch and prepares all current payments again", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    mocks.batch.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("Cancelled."))),
        ),
    );
    mocks.batch.mockReturnValueOnce(new Promise(() => undefined));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry all payments" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.batch.mock.calls[0][0].signal.aborted).toBe(true);
    expect(mocks.saved()).toMatchObject({ id: "unknown", refreshable: true });
    fireEvent.click(screen.getByRole("button", { name: "Retry all payments" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(14);
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume saved batch" })).toBeNull();
    expect(mocks.prepare).toHaveBeenCalledTimes(28);
  });

  it("requires a fresh full-set review after a failed submission and captures the current saved identity", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    mocks.batch.mockImplementationOnce(async () => {
      mocks.saved.mockReturnValue({
        id: "newer-unknown",
        scope: "legacy",
        completed: 0,
        total: 3,
        refreshable: true,
      });
      throw new Error("The saved batch changed. Review again.");
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry all payments" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review again" }));
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(within(screen.getByRole("dialog")).getAllByRole("listitem")).toHaveLength(14);
    expect(mocks.prepare).toHaveBeenCalledTimes(28);
    expect(mocks.batch.mock.calls[0][0].refreshBatchId).toBe("unknown");
    expect(mocks.batch.mock.calls[1][0]).toMatchObject({
      refreshBatchId: "newer-unknown",
      calls: Array.from({ length: 14 }, (_, i) => ({ id: `item-${i}` })),
    });
  });

  it("blocks refreshing a hashless selection when the reviewed account changes", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
    });
    mocks.batch.mockResolvedValueOnce({ status: "pending", hashes: [] });
    const rendered = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    const retry = await screen.findByRole("button", { name: "Try again" });
    mocks.address = "0x0000000000000000000000000000000000000002";
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PendingRoutingPayments projects={projects} />
      </QueryClientProvider>,
    );
    fireEvent.click(retry);
    await screen.findByText(/connected account changed/);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("keeps submitted selections in recovery without offering a fresh batch", async () => {
    mocks.saved.mockReturnValue({
      id: "submitted",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: false,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    setup();
    await screen.findByText("14 payments ready to retry.");
    expect(screen.queryByRole("button", { name: "Retry all payments" })).toBeNull();
    expect(
      screen
        .getAllByRole("button", { name: "Retry payment" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Resume saved batch" }));
    expect(within(await screen.findByRole("dialog")).queryByRole("checkbox")).toBeNull();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("keeps the batch action above the payment list", async () => {
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? [row("one").indexed, row("two").indexed] : [],
    );
    setup();
    const batch = await screen.findByRole("button", { name: "Retry all payments" });
    const firstRetry = screen.getAllByRole("button", { name: "Retry payment" })[0];
    expect(
      batch.compareDocumentPosition(firstRetry) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("resumes the saved selection when the index is already empty without preparing another call", async () => {
    mocks.indexed.mockResolvedValue([]);
    mocks.saved.mockReturnValue({
      id: "original-batch",
      scope: "pending-routing:1:6",
      completed: 1,
      total: 2,
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Resume saved batch" }));
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "pending-routing:1:6",
          expectedBatchId: "original-batch",
          calls: [],
        }),
      ),
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("shows the full discovered inventory while checking a saved three-attempt selection", async () => {
    let finish!: () => void;
    const check = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.saved.mockReturnValue({ scope: "legacy", completed: 0, total: 3 });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1
        ? Array.from({ length: 7 }, (_, i) => ({
            ...row(`item-${i}`).indexed,
            amount: "100",
            token: mocks.address,
          }))
        : [],
    );
    mocks.payment.mockImplementation(async (_client, indexed) => {
      await check;
      return row(indexed.pendingCallId);
    });
    setup();
    expect(await screen.findByText("7 payments need processing.")).toBeTruthy();
    expect(screen.getAllByText("Checking payment amount")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Resume saved batch" })).toBeEnabled();
    expect(screen.getByText(/Saved batch: 0 of 3 attempts handled/)).toBeTruthy();
    expect(mocks.prepare).not.toHaveBeenCalled();
    finish();
    await screen.findByText("7 payments ready to retry.");
    expect(screen.getAllByText("0.1 ETH")).toHaveLength(7);
    expect(
      screen
        .getAllByRole("button", { name: "Retry payment" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("keeps discovered payments visible when a chain check fails, excluding resolved rows", async () => {
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1
        ? [row("ok").indexed, row("failed").indexed, row("resolved").indexed]
        : [],
    );
    mocks.payment.mockImplementation(async (_client, indexed) => {
      if (indexed.pendingCallId === "failed") throw new Error("RPC unavailable");
      return indexed.pendingCallId === "resolved" ? null : row(indexed.pendingCallId);
    });
    setup();
    await screen.findByText("Could not verify payment: RPC unavailable");
    expect(screen.getAllByText("To Project 1 on Ethereum")).toHaveLength(2);
    expect(screen.getByText("0.1 ETH")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry all payments" })).toBeDisabled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("replaces an untouched three-call draft with the full freshly reviewed selection", async () => {
    mocks.saved.mockReturnValue({
      id: "old-draft",
      scope: "legacy",
      completed: 0,
      total: 3,
      replaceableDraft: true,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 8 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    const rendered = setup();
    const release = holdPreparation();
    fireEvent.click(await screen.findByRole("button", { name: "Retry all payments" }));
    expect(screen.queryByRole("button", { name: "Resume saved batch" })).toBeNull();
    expect(screen.queryByText(/Saved batch:/)).toBeNull();
    // A later journal update must not silently change the selection under review.
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalled());
    mocks.saved.mockReturnValue({ ...NEWER_JOURNAL, replaceableDraft: false });
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PendingRoutingPayments projects={projects} />
      </QueryClientProvider>,
    );
    await release();
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "pending-routing:destination:1:1,8453:1",
          replaceDraftId: "old-draft",
          calls: Array.from({ length: 8 }, (_, i) => ({ id: `item-${i}` })),
        }),
      ),
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(8);
  });

  it("requires a fresh review after a failed draft replacement instead of reusing its old identity", async () => {
    mocks.saved.mockReturnValue({
      id: "old-draft",
      scope: "legacy",
      completed: 0,
      total: 3,
      replaceableDraft: true,
    });
    mocks.batch.mockImplementationOnce(async () => {
      mocks.saved.mockReturnValue(undefined);
      throw new Error("Quote unavailable");
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review again" }));
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    expect(mocks.batch.mock.calls[0][0].replaceDraftId).toBe("old-draft");
    expect(mocks.batch.mock.calls[1][0].replaceDraftId).toBeUndefined();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  it("shows the saved payment details and exact recovery reason while continuing", async () => {
    mocks.batch.mockReturnValue(new Promise(() => undefined));
    mocks.saved.mockReturnValue({
      id: "held",
      scope: "legacy",
      completed: 0,
      total: 1,
      replaceableDraft: false,
      recoveryReason: "The previous wallet submission has an unknown result.",
      calls: [{ chainId: 8453, state: "submitting" }],
    });
    mocks.describe.mockReturnValue({
      id: "saved",
      chainId: 8453,
      projectId: "1",
      sourceProjectId: "6",
      amountLabel: "1.3 USDC",
      beneficiary: mocks.address,
      pendingCallId: "0x1234",
      state: "submitting",
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Resume saved batch" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("The previous wallet submission has an unknown result."),
    ).toBeTruthy();
    expect(within(dialog).getByText("1.3 USDC")).toBeTruthy();
    expect(within(dialog).getByText("Project 6")).toBeTruthy();
    expect(within(dialog).getByText("submitting")).toBeTruthy();
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("rechecks a saved reservation without submitting and unlocks a proven released draft", async () => {
    const held = { id: "held", scope: "legacy", completed: 0, total: 3, replaceableDraft: false };
    mocks.saved.mockReturnValue(held);
    mocks.recheck.mockImplementation(async () => {
      const checked = {
        ...held,
        replaceableDraft: true,
        recoveryReason: "The unpaid quote expired.",
      };
      mocks.saved.mockReturnValue(checked);
      return checked;
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? [row("a").indexed, row("b").indexed] : [],
    );
    setup();
    expect(await screen.findByRole("button", { name: "Retry all payments" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Resume saved batch" })).toBeNull();
    expect(mocks.recheck).toHaveBeenCalledTimes(1);
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("does not switch an open saved review to a different journal after a status check", async () => {
    const first = {
      id: "first",
      scope: "first-scope",
      completed: 0,
      total: 1,
      replaceableDraft: false,
    };
    mocks.saved.mockReturnValue(first);
    mocks.batch.mockResolvedValueOnce({ status: "pending", hashes: [] });
    setup();
    await waitFor(() => expect(mocks.recheck).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Resume saved batch" }));
    await screen.findByRole("button", { name: "Try again" });
    mocks.recheck.mockResolvedValue({ ...first, id: "other", scope: "other-scope" });
    fireEvent.click(screen.getByRole("button", { name: "Re-check saved status" }));
    await screen.findByRole("button", { name: "Review again" });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("defers automatic recovery checks until its active batch releases the execution lock", async () => {
    let finish!: (result: unknown) => void;
    let processing = true;
    const saved = {
      id: "active-batch",
      scope: "pending-routing:destination:1:1,8453:1",
      completed: 0,
      total: 1,
      recoveryReason: "Checking the submitted payment.",
    };
    mocks.batch.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    mocks.recheck.mockImplementation(async () => {
      if (processing) throw new Error("Another multichain batch is already being processed.");
      return saved;
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    await screen.findByRole("dialog", { name: "Retry payments" });
    act(() => {
      mocks.saved.mockReturnValue(saved);
      mocks.batch.mock.calls[0][0].onBeforePayment();
      mocks.batch.mock.calls[0][0].onProgress("Checking payment and 1 transaction result…");
    });
    expect(screen.getByRole("button", { name: "Resume saved batch" })).toBeDisabled();
    expect(mocks.recheck).not.toHaveBeenCalled();
    expect(screen.queryByText(/Another multichain batch/)).toBeNull();

    await act(async () => {
      processing = false;
      finish({ status: "pending", hashes: [] });
    });
    await waitFor(() => expect(mocks.recheck).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Another multichain batch/)).toBeNull();
    expect(screen.getByText(/Saved batch: 0 of 1 attempts handled/)).toHaveTextContent(
      "Checking the submitted payment.",
    );
  });

  it("blocks submit if the wallet changed after review", async () => {
    mocks.batch.mockRejectedValueOnce(new Error("Quote unavailable"));
    const rendered = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    const retry = await screen.findByRole("button", { name: "Try again" });
    mocks.address = "0x0000000000000000000000000000000000000002";
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PendingRoutingPayments projects={projects} />
      </QueryClientProvider>,
    );
    fireEvent.click(retry);
    await screen.findByText(/connected account changed/);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("keeps the authenticated obsolete Safe proposal and cancellation nonce visible", async () => {
    const hash = `0x${"a".repeat(64)}`;
    mocks.batch.mockResolvedValue({
      status: "pending",
      hashes: [],
      obsoleteSafeProposals: [{ chainId: 1, safe: mocks.address, hash, nonce: 7, callIndex: 0 }],
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    const link = await screen.findByRole("link", { name: `Safe proposal ${hash}` });
    expect(link.getAttribute("href")).toContain(`safe=eth:${mocks.address}`);
    expect(screen.getByText(/Cancel or replace nonce 7/)).toBeTruthy();
    expect(screen.queryByText(/Routing review complete/)).toBeNull();
  });

  it("goes back with Cancel before anything is paid", async () => {
    mocks.batch.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("Cancelled."))),
        ),
    );
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Retry payments" });

    fireEvent.click(await within(dialog).findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.batch.mock.calls[0][0].signal.aborted).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry payment" })).toBeEnabled(),
    );
  });

  it("refuses every way out after preparation reaches the payment boundary", async () => {
    let finish!: (result: unknown) => void;
    mocks.batch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    const dialog = (await screen.findByRole("dialog", {
      name: "Retry payments",
    })) as HTMLDialogElement;
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    const close = within(dialog).getByRole("button", { name: "Close" });
    const cancel = await within(dialog).findByRole("button", { name: "Cancel" });
    expect(close).toBeEnabled();
    expect(cancel).toBeEnabled();
    act(() => {
      mocks.batch.mock.calls[0][0].onBeforePayment();
      // The boundary locks immediately, before React renders the disabled close control.
      fireEvent.click(close);
      fireEvent.click(cancel);
    });
    expect(close).toBeDisabled();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Preparing routing…");
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole("dialog", { name: "Retry payments" })).toBe(dialog);
    expect(mocks.batch.mock.calls[0][0].signal.aborted).toBe(false);

    finish({ status: "success", hashes: [] });
    await within(dialog).findByRole("button", { name: "Done" });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("shows passive progress for all 14 payments and restores the action after a timeout", async () => {
    let fail!: (cause: Error) => void;
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    mocks.batch.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry all payments" }));
    const dialog = await screen.findByRole("dialog", { name: "Retry payments" });

    expect(await within(dialog).findByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Preparing routing…");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(14);
    expect(within(dialog).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    expect(mocks.batch.mock.calls[0][0].calls).toHaveLength(14);

    act(() => mocks.batch.mock.calls[0][0].onProgress("Requesting network fee…"));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Requesting network fee…");
    expect(within(dialog).queryByText("Preparing routing…")).toBeNull();
    await act(async () => fail(new Error("The network-fee request timed out. Try again.")));

    expect(within(dialog).getByText("The network-fee request timed out. Try again.")).toBeTruthy();
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    const confirm = within(dialog).getByRole("button", { name: "Try again" });
    expect(confirm).toBeEnabled();
    expect(mocks.batch).toHaveBeenCalledTimes(1);

    fireEvent.click(confirm);
    await within(dialog).findByRole("button", { name: "Done" });
    expect(mocks.batch).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "error"])(
    "cancels quote preparation and ignores its late %s and progress callbacks",
    async (outcome) => {
      let finish!: (result: unknown) => void;
      let fail!: (cause: Error) => void;
      mocks.batch.mockReturnValueOnce(
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
      );
      setup();
      fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
      const dialog = await screen.findByRole("dialog", { name: "Retry payments" });
      const way = await within(dialog).findByRole("button", {
        name: outcome === "success" ? "Cancel" : "Close",
      });
      const options = mocks.batch.mock.calls[0][0];
      expect(options.signal.aborted).toBe(false);
      fireEvent.click(way);
      expect(options.signal.aborted).toBe(true);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("button", { name: "Retry payment" })).toBeDisabled();

      await act(async () => {
        options.onProgress("Late quote progress");
        options.onCallProgress([{ status: "confirmed" }]);
        options.onBeforePayment();
        if (outcome === "success") finish({ status: "success", hashes: [] });
        else fail(new Error("Late quote failure"));
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByText(/Late quote/)).toBeNull();
      expect(screen.queryByText(/Routing review complete/)).toBeNull();
      expect(screen.getByRole("button", { name: "Retry payment" })).toBeEnabled();
      expect(mocks.batch).toHaveBeenCalledTimes(1);

      mocks.batch.mockReturnValueOnce(new Promise(() => undefined));
      fireEvent.click(screen.getByRole("button", { name: "Retry payment" }));
      const nextDialog = await screen.findByRole("dialog", { name: "Retry payments" });
      await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
      act(() => {
        options.onProgress("Late quote progress");
        options.onCallProgress([{ status: "confirmed" }]);
      });
      expect(within(nextDialog).queryByText(/Late quote/)).toBeNull();
      expect(within(nextDialog).queryByText("Confirmed")).toBeNull();
      expect(within(nextDialog).queryByRole("button", { name: "Done" })).toBeNull();
    },
  );

  it.each(["quote", "payment"])(
    "unmounting during %s only aborts preparation and ignores late completion",
    async (phase) => {
      let finish!: (result: unknown) => void;
      mocks.batch.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      const rendered = setup();
      fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
      await screen.findByRole("dialog", { name: "Retry payments" });
      const options = mocks.batch.mock.calls[0][0];
      if (phase === "payment") act(() => options.onBeforePayment());
      expect(options.signal.aborted).toBe(false);

      rendered.unmount();
      expect(options.signal.aborted).toBe(phase === "quote");
      const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
      try {
        await act(async () => {
          options.onProgress("Late progress after navigation");
          options.onCallProgress([{ status: "confirmed" }]);
          finish({ status: "success", hashes: [] });
        });
        expect(invalidate).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
      } finally {
        invalidate.mockRestore();
      }
    },
  );

  it("shows each of 14 independently checked results in the modal through completion", async () => {
    let finish!: (result: unknown) => void;
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    mocks.prepare.mockImplementation(async (_client, indexed) => ({
      payment: {
        ...row(indexed.pendingCallId),
        amountLabel: `${Number(indexed.pendingCallId.slice(5)) + 1} ETH`,
      },
      call: { id: indexed.pendingCallId },
    }));
    mocks.batch.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry all payments" }));
    const dialog = await screen.findByRole("dialog", { name: "Retry payments" });
    expect(within(dialog).queryByText("Waiting")).toBeNull();
    const options = mocks.batch.mock.calls[0][0];
    expect(options.calls).toEqual(Array.from({ length: 14 }, (_, i) => ({ id: `item-${i}` })));

    act(() => {
      options.onBeforePayment();
      options.onProgress("0 of 14 results checked. 12 submitted; 2 waiting.");
      options.onCallProgress(
        Array.from({ length: 14 }, (_, i) => ({
          status: i === 0 || i === 8 ? "pending" : "submitted",
        })),
      );
    });
    expect(within(dialog).getByRole("status")).toHaveTextContent("0 of 14 results checked");
    expect(within(dialog).getAllByText("Checking result")).toHaveLength(12);
    expect(within(dialog).getAllByText("Waiting")).toHaveLength(2);
    const items = within(dialog).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-state", "pending");
    expect(items[1]).toHaveAttribute("data-state", "active");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Retry" })).toBeNull();

    act(() => {
      options.onProgress("13 of 14 results checked. 12 confirmed; 1 reverted; 1 waiting.");
      options.onCallProgress(
        Array.from({ length: 14 }, (_, i) => ({
          status: i === 0 ? "pending" : i === 4 ? "reverted" : "confirmed",
        })),
      );
    });
    expect(within(dialog).getByRole("status")).toHaveTextContent("13 of 14 results checked");
    expect(within(dialog).getAllByText("Confirmed")).toHaveLength(12);
    expect(within(dialog).getByText("Waiting")).toBeTruthy();
    expect(items[0]).toHaveAttribute("data-state", "pending");
    expect(items[13]).toHaveAttribute("data-state", "complete");
    expect(items[13]).toHaveTextContent("14 ETH to Project 1");
    expect(items[4]).toHaveAttribute("data-state", "failed");
    expect(items[4]).toHaveTextContent("5 ETH to Project 1");
    expect(items[4]).toHaveTextContent("Reverted");
    expect(items[4]).toHaveTextContent("×");
    expect(items[4]).not.toHaveTextContent("✓");

    await act(async () => {
      options.onCallProgress(
        Array.from({ length: 14 }, (_, i) => ({
          status: i === 0 ? "skipped" : i === 4 ? "reverted" : "confirmed",
        })),
      );
      finish({ status: "success", hashes: [], revertedHashes: [`0x${"a".repeat(64)}`] });
    });
    const done = await within(dialog).findByRole("button", { name: "Done" });
    expect(within(dialog).getByText("Already handled")).toBeTruthy();
    expect(within(dialog).getAllByText("Confirmed")).toHaveLength(12);
    expect(items[4]).toHaveAttribute("data-state", "failed");
    expect(items[4]).not.toHaveTextContent("✓");
    expect(mocks.batch).toHaveBeenCalledTimes(1);

    mocks.batch.mockReturnValueOnce(new Promise(() => undefined));
    fireEvent.click(done);
    fireEvent.click(await screen.findByRole("button", { name: "Retry all payments" }));
    const nextDialog = await screen.findByRole("dialog", { name: "Retry payments" });
    act(() => options.onCallProgress(Array.from({ length: 14 }, () => ({ status: "confirmed" }))));
    expect(within(nextDialog).queryByText("Confirmed")).toBeNull();
    expect(within(nextDialog).queryByText("Already handled")).toBeNull();
    expect(
      within(nextDialog)
        .getAllByRole("listitem")
        .every((item) => item.getAttribute("data-state") !== "complete"),
    ).toBe(true);
  });

  it("ends the round on Done, still listing what it routed", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Retry payments" });

    const done = await within(dialog).findByRole("button", { name: "Done" });
    expect(dialog).toHaveTextContent(/Routing review complete/);
    expect(within(dialog).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    const routed = within(dialog).getAllByRole("listitem");
    expect(routed).toHaveLength(1);
    expect(routed[0]).toHaveAttribute("data-state", "complete");
    expect(routed[0]).toHaveTextContent("0.1 ETH to Project 1");

    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });
});
