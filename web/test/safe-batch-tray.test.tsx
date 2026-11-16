import { SafeBatchTray } from "@/app/[slug]/components/v6/operator/SafeBatchTray";
import { buildStep, readBatch, writeBatch } from "@/lib/safe-batch";
import { NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmIsOpen, expectEveryWayOutRefused } from "./support/confirm";
import { groupGateState } from "./support/group-write-gate";

vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

const OPERATOR = `0x${"22".repeat(20)}` as Address;
const HOOK = "0xB222Da5A71e8FB89a5A38b7c920EaB5DfbC74B91" as Address;
const TERMINAL = "0x4a56AEf5b6A5b9742AbB02cA67C5a85ba183D901" as Address;
const ROWS = [
  { chainId: 8453 as const, projectId: 6 },
  { chainId: 10 as const, projectId: 7 },
];

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  route: { kind: "eoa" } as { kind: string },
  /** Whether a wallet is connected. ButtonWithWallet's own test pins what it shows without one. */
  connected: true,
  proposed: null as null | Record<string, unknown>,
  proposedQuery: undefined as undefined | { enabled?: boolean },
  preset: {
    status: "ready" as const,
    steps: [] as unknown[],
    notes: [] as string[],
    dropped: [] as unknown[],
  },
}));

// The route and preset reads need RPC; the shell test has none, so useQuery
// answers each key with its fixture and the submit hook is a spy.
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ fetchQuery: vi.fn() }),
  useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => {
    if (queryKey[0] === "revnet-safe-batch-proposed") mocks.proposedQuery = { enabled };
    return {
      data:
        queryKey[0] === "safe-batch-route"
          ? { ...mocks.route, authority: OPERATOR }
          : queryKey[0] === "safe-batch-preset"
            ? ROWS.map((row) => ({ row, result: mocks.preset }))
            : queryKey[0] === "revnet-safe-batch-proposed"
              ? mocks.proposed
              : undefined,
      isLoading: false,
      isError: false,
    };
  },
}));
vi.mock("@/app/[slug]/components/v6/operator/useSafeBatchSubmit", () => ({
  useSafeBatchSubmit: () => ({
    routeFor: vi.fn(),
    submit: mocks.submit,
  }),
}));
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: () => ({
    operatorByChain: new Map([
      [8453, OPERATOR],
      [11155420, OPERATOR],
    ]),
    isLoading: false,
  }),
}));
vi.mock("@/lib/reviewed-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reviewed-call")>()),
  isSafeProposalPendingError: (error: unknown) =>
    error instanceof Error && error.name === "SafeProposalPendingError",
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _target,
    connectWalletText,
    ...props
  }: {
    children: React.ReactNode;
    loading?: boolean;
    targetChainId?: number;
    connectWalletText?: string;
  }) =>
    mocks.connected ? (
      <button {...props}>{children}</button>
    ) : (
      <button type="button">{connectWalletText ?? "Connect Wallet"}</button>
    ),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: OPERATOR, chainId: 8453 }),
  useChainId: () => 8453,
  useConfig: () => ({}),
  useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false }),
}));

const hookStep = () =>
  buildStep({ kind: "setHookFor", chainId: 8453, projectId: 6, values: { hook: HOOK } });
const poolStep = () =>
  buildStep({
    kind: "setPoolFor",
    chainId: 8453,
    projectId: 6,
    values: { fee: 10_000n, tickSpacing: 200n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
  });
const terminalStep = () =>
  buildStep({
    kind: "setTerminalFor",
    chainId: 8453,
    projectId: 6,
    values: { terminal: TERMINAL },
  });

describe("SafeBatchTray", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.submit.mockReset();
    mocks.route = { kind: "eoa" };
    mocks.connected = true;
    mocks.proposed = null;
    groupGateState.reset();
  });

  it("wallet-action:safe-batch will not send a batch for a row the sucker registry does not list", async () => {
    groupGateState.unverified = ["8453:6"];
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and propose on Base" }));
    const dialog = await screen.findByRole("dialog", { name: "Batch on Base" });
    expect(within(dialog).getByText("A project listed here isn't linked onchain.")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send 2 transactions" });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("shows a queued proposal in place of the review button and can drop the steps", () => {
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    mocks.proposed = {
      tx: {
        nonce: 10,
        safeTxHash: `0x${"cd".repeat(32)}`,
        confirmations: [
          { owner: OPERATOR, signature: `0x${"ab".repeat(65)}` },
          // Not an owner of the Safe now, so it signs for nothing.
          { owner: HOOK, signature: `0x${"ab".repeat(65)}` },
        ],
      },
      owners: [OPERATOR, TERMINAL],
      threshold: 2,
    };
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    expect(mocks.proposedQuery).toEqual({ enabled: true });
    expect(screen.getByRole("status").textContent).toContain(
      "Already proposed on Base as Safe transaction #10 (1/2 signatures)",
    );
    expect(screen.getByRole("link", { name: /Open in Safe/ }).getAttribute("href")).toContain(
      "multisig_",
    );
    expect(screen.queryByRole("button", { name: /Review and propose/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove from the batch" }));
    expect(readBatch(8453, 6)).toEqual([]);
  });

  it("reads no Safe queue on a chain where Safe hosts no transaction service", () => {
    const opSepolia = { chainId: 11155420 as const, projectId: 6 };
    writeBatch(11155420, 6, [
      buildStep({ kind: "setHookFor", chainId: 11155420, projectId: 6, values: { hook: HOOK } }),
    ]);
    render(<SafeBatchTray rows={[opSepolia]} fallbackProject={opSepolia} />);
    expect(mocks.proposedQuery).toEqual({ enabled: false });
  });

  it("shows one tab per chain with queued steps, read from storage", () => {
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    expect(screen.getByRole("tab", { name: "Base (2)" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Optimism/ })).toBeNull();
    expect(screen.getByRole("table").textContent).toContain("Set buyback hook");
    expect(screen.getByRole("table").textContent).toContain("Set router terminal");
    expect(screen.getByRole("button", { name: "Start from a preset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the Base batch to every chain" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
  });

  it("keeps only the preset button when nothing is queued, and Clear all empties every chain", () => {
    const { unmount } = render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    expect(screen.getByText(/Nothing queued\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    unmount();

    writeBatch(8453, 6, [hookStep()]);
    writeBatch(10, 7, [
      buildStep({ kind: "setHookFor", chainId: 10, projectId: 7, values: { hook: HOOK } }),
    ]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(readBatch(8453, 6)).toEqual([]);
    expect(readBatch(10, 7)).toEqual([]);
    expect(screen.getByText(/Nothing queued\./)).toBeTruthy();
  });

  it("opens the chain's batch dialog listing each step with its decoded call", async () => {
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and propose on Base" }));

    const dialog = await screen.findByRole("dialog", { name: "Batch on Base" });
    const list = screen.getByRole("list", { name: "Batch steps" });
    expect(dialog.contains(list)).toBe(true);
    const items = list.querySelectorAll(":scope > li");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Set buyback hook");
    expect(items[0]!.textContent).toContain("setHookFor(uint256, address)");
    expect(items[0]!.textContent).toContain(HOOK);
    expect(items[1]!.textContent).toContain("Set router terminal");
    expect(items[1]!.textContent).toContain("setTerminalFor(uint256, address)");
    expect(dialog.textContent).toContain("2 transactions from your wallet, in order");
    expect(dialog.textContent).toContain("Wallet");
    expect(screen.getByRole("button", { name: "Send 2 transactions" })).not.toBeDisabled();
  });

  it("shows the dependency message on the offending step, disables the action, and lets ↑ fix it", async () => {
    writeBatch(8453, 6, [poolStep(), hookStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and propose on Base" }));
    await screen.findByRole("dialog", { name: "Batch on Base" });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Set the buyback hook before registering its pool/);
    const first = screen.getByRole("list", { name: "Batch steps" }).querySelector(":scope > li")!;
    expect(first.contains(alert)).toBe(true);
    expect(screen.getByRole("button", { name: "Send 2 transactions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(readBatch(8453, 6).map((step) => step.kind)).toEqual(["setHookFor", "setPoolFor"]);
    expect(screen.getByRole("button", { name: "Send 2 transactions" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move step 1 down" }));
    await screen.findByRole("alert");
    expect(readBatch(8453, 6).map((step) => step.kind)).toEqual(["setPoolFor", "setHookFor"]);
  });

  it("removes a step from storage and updates the chip", async () => {
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and propose on Base" }));
    await screen.findByRole("dialog", { name: "Batch on Base" });

    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
    await waitFor(() =>
      expect(readBatch(8453, 6).map((step) => step.kind)).toEqual(["setTerminalFor"]),
    );
    expect(screen.getByRole("tab", { name: "Base (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send 1 transaction" })).toBeTruthy();
  });

  it("wallet-action:safe-batch submits the queued steps through the routed path and clears the chain on success", async () => {
    mocks.submit.mockResolvedValue({ kind: "sent", transactions: 2 });
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and propose on Base" }));
    await screen.findByRole("dialog", { name: "Batch on Base" });

    fireEvent.click(screen.getByRole("button", { name: "Send 2 transactions" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit.mock.calls[0]![0]).toMatchObject({
      chainId: 8453,
      route: { kind: "eoa" },
      steps: [
        expect.objectContaining({ kind: "setHookFor" }),
        expect.objectContaining({ kind: "setTerminalFor" }),
      ],
    });
    await waitFor(() => expect(readBatch(8453, 6)).toEqual([]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stages a preset's resolved steps per chain and adds them to the batch without submitting", async () => {
    mocks.preset.steps = [hookStep(), poolStep(), terminalStep()];
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Start from a preset" }));
    const dialog = await screen.findByRole("dialog", { name: "Move to buyback 2.0.0 + gateway" });
    expect(dialog.textContent).toContain("Set buyback pool");

    // The preset's 30 minute TWAP window is fixed: nothing in the dialog edits it.
    expect(screen.queryByRole("textbox", { name: /TWAP window/ })).toBeNull();

    // Both chains are pre-checked; drop Optimism and add Base's three.
    const optimism = screen.getByRole("checkbox", { name: "Optimism" });
    fireEvent.click(optimism);
    fireEvent.click(screen.getByRole("button", { name: "Add 3 steps to batch" }));

    await waitFor(() => expect(readBatch(8453, 6)).toHaveLength(3));
    expect(readBatch(8453, 6)[1]!.values.twapWindow).toBe(1_800n);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Base (3)" })).toBeTruthy();
  });

  it("ends on Done when the batch went to the Safe app as a proposal", async () => {
    mocks.route = { kind: "safe-app" };
    mocks.submit.mockRejectedValue(
      Object.assign(new Error("The batch was proposed to Safe, but it has not executed."), {
        name: "SafeProposalPendingError",
      }),
    );
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and propose on Base" }));
    const dialog = await screen.findByRole("dialog", { name: "Batch on Base" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Propose batch to Safe" }));
    const done = await within(dialog).findByRole("button", { name: "Done" });
    expect(dialog).toHaveTextContent("The batch was proposed to Safe");
    expect(within(dialog).queryByRole("button", { name: "Propose batch to Safe" })).toBeNull();
    fireEvent.click(done);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("refuses every way out while the batch is sent", async () => {
    let finish!: (outcome: unknown) => void;
    mocks.submit.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review and propose on Base" }));
    const dialog = await screen.findByRole("dialog", { name: "Batch on Base" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send 2 transactions" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));

    const confirm = dialog.querySelector<HTMLElement>("[data-tx-confirm]")!;
    expect(within(confirm).getByRole("button", { name: "Send 2 transactions" })).toBeDisabled();
    expectEveryWayOutRefused(confirm);

    finish({ kind: "sent", transactions: 2 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("asks for a wallet before the batch's confirm opens", () => {
    mocks.connected = false;
    writeBatch(8453, 6, [hookStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);

    expect(screen.queryByRole("button", { name: /Review and propose/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(confirmIsOpen()).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
