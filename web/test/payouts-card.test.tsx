import { PayoutsCard } from "@/app/[slug]/components/v6/owners/settlement/PayoutsCard";
import type { PayoutOption } from "@/app/[slug]/components/v6/owners/settlement/payouts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmIsOpen, expectEveryWayOutRefused, findConfirm } from "./support/confirm";
import { groupGateState } from "./support/group-write-gate";

const mocks = vi.hoisted(() => ({
  account: "0x0000000000000000000000000000000000000001",
  runBatch: vi.fn(),
  getPendingBatch: vi.fn(),
  fetchPayoutOptions: vi.fn(),
  readPayoutOptions: vi.fn(),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.account }) }));
vi.mock("@/hooks/useMultichainBatch", () => ({
  useMultichainBatch: () => ({ runBatch: mocks.runBatch, getPendingBatch: mocks.getPendingBatch }),
}));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: (chainId: number) => ({ chainId }),
}));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  formatWalletError: (error: Error) => error.message,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    loading: _loading,
    children,
    ...props
  }: ComponentProps<"button"> & { loading?: boolean }) => <button {...props}>{children}</button>,
}));
vi.mock("@/app/[slug]/components/v6/owners/settlement/lib", () => ({
  chainName: (chainId: number) => (chainId === 8453 ? "Base" : "Arbitrum"),
  chainProjectsKey: (chains: { chainId: number; projectId: bigint }[]) =>
    chains
      .map((chain) => `${chain.chainId}:${chain.projectId}`)
      .sort()
      .join(","),
  tokenSymbolOf: vi.fn(),
}));
vi.mock("@/app/[slug]/components/v6/owners/settlement/payouts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/app/[slug]/components/v6/owners/settlement/payouts")
  >()),
  fetchPayoutOptions: mocks.fetchPayoutOptions,
  readPayoutOptions: mocks.readPayoutOptions,
}));

const chains = [
  { chainId: 8453 as const, projectId: 42n },
  { chainId: 42161 as const, projectId: 99n },
];
const base: PayoutOption = {
  ...chains[0],
  key: "base-usdc",
  terminal: "0x0000000000000000000000000000000000000011",
  token: "0x0000000000000000000000000000000000000012",
  symbol: "USDC",
  decimals: 6,
  currency: 2,
  accountingCurrency: 2,
  rulesetId: 100,
  cycleNumber: 7,
  owner: "0x0000000000000000000000000000000000000013",
  splits: [],
  remainingLimit: 20_000_000n,
  availableAmount: 20_000_000n,
  balance: 20_000_000n,
  price: 10n ** 18n,
  preconditions: [
    { address: "0x0000000000000000000000000000000000000011", data: "0x1234", expected: "0x5678" },
  ],
  sourceKey: "0x1234",
};
const arb: PayoutOption = {
  ...base,
  ...chains[1],
  key: "arb-eth",
  symbol: "ETH",
  decimals: 18,
  currency: 1,
  accountingCurrency: 1,
  terminal: "0x0000000000000000000000000000000000000021",
  token: "0x0000000000000000000000000000000000000022",
  owner: "0x0000000000000000000000000000000000000023",
  rulesetId: 101,
  cycleNumber: 8,
  balance: 10n ** 18n,
  availableAmount: 10n ** 18n,
  remainingLimit: 10n ** 18n,
  splits: [
    {
      percent: 1_000_000_000,
      beneficiary: zeroAddress,
      projectId: 0n,
      hook: zeroAddress,
      lockedUntil: 0,
      preferAddToBalance: false,
    },
  ],
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PayoutsCard chains={chains} />
    </QueryClientProvider>,
  );
}
async function selectAll() {
  await screen.findByText(/Available 20 USDC/);
  fireEvent.click(screen.getByRole("button", { name: "Select available chains" }));
}

beforeEach(() => {
  groupGateState.reset();
  mocks.account = "0x0000000000000000000000000000000000000001";
  mocks.getPendingBatch.mockReturnValue(undefined);
  mocks.runBatch.mockResolvedValue({ status: "success", hashes: [] });
  mocks.fetchPayoutOptions.mockResolvedValue(
    chains.map((chain, index) => ({ ...chain, options: [index ? arb : base], error: null })),
  );
  mocks.readPayoutOptions.mockImplementation(async (_client, project) => [
    project.chainId === 8453 ? { ...base } : { ...arb },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("reachable selected-chain payouts", () => {
  it("wallet-action:payouts freezes distinct project IDs, assets, decimal amounts, minimums and recipients into one batch", async () => {
    setup();
    await selectAll();
    fireEvent.change(screen.getByLabelText("Payout amount on Base"), { target: { value: "1.25" } });
    // The minimum is optional: its field shows once its checkbox is on.
    expect(screen.queryByLabelText("Minimum payout on Base")).toBeNull();
    fireEvent.click(screen.getByLabelText("Set minimum received on Base"));
    fireEvent.click(screen.getByLabelText("Set minimum received on Arbitrum"));
    fireEvent.change(screen.getByLabelText("Minimum payout on Base"), { target: { value: "1.2" } });
    fireEvent.change(screen.getByLabelText("Payout amount on Arbitrum"), {
      target: { value: "0.3" },
    });
    fireEvent.change(screen.getByLabelText("Minimum payout on Arbitrum"), {
      target: { value: "0.29" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review selected payouts" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(1));
    const lines = JSON.stringify(mocks.runBatch.mock.calls[0][0].context);
    expect(lines).toContain(`100% to project owner ${base.owner}`);
    expect(lines).toContain(`100% to caller ${mocks.account}`);
    expect(mocks.runBatch.mock.calls[0][0].calls).toMatchObject([
      {
        chainId: 8453,
        address: base.terminal,
        args: [42n, base.token, 1_250_000n, 2n, 1_200_000n],
        preconditions: base.preconditions,
      },
      {
        chainId: 42161,
        address: arb.terminal,
        args: [99n, arb.token, 300_000_000_000_000_000n, 1n, 290_000_000_000_000_000n],
      },
    ]);
    expect(mocks.readPayoutOptions).toHaveBeenCalledTimes(2);
    await screen.findByText("Payout transactions confirmed on all selected chains.");
    // Sent: the confirm closes on its own and the card says what landed.
    expect(confirmIsOpen()).toBe(false);
  });

  it("refuses every way out while the payouts send", async () => {
    let finish!: (outcome: unknown) => void;
    mocks.runBatch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup();
    await selectAll();
    fireEvent.click(screen.getByRole("button", { name: "Review selected payouts" }));
    const confirm = await findConfirm();
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(1));

    expectEveryWayOutRefused(confirm);

    finish({ status: "success", hashes: [] });
    await waitFor(() => expect(confirmIsOpen()).toBe(false));
    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
  });

  it("wallet-action:payouts will not review a chain the registry does not list until it is deselected", async () => {
    groupGateState.unverified = ["42161:99"];
    setup();
    await selectAll();
    const review = screen.getByRole("button", { name: "Review selected payouts" });
    expect(screen.getByText("A project listed here isn't linked onchain.")).toBeTruthy();
    expect(review).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Arbitrum" }));
    expect(screen.queryByText("A project listed here isn't linked onchain.")).toBeNull();
    expect(review).not.toBeDisabled();
    expect(mocks.readPayoutOptions).not.toHaveBeenCalled();
  });

  it("keeps deselected chains out of both preparation and submission", async () => {
    setup();
    await screen.findByText(/Available 20 USDC/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Base" }));
    fireEvent.click(screen.getByRole("button", { name: "Review selected payouts" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(1));
    expect(mocks.runBatch.mock.calls[0][0].calls).toHaveLength(1);
    expect(mocks.readPayoutOptions).toHaveBeenCalledTimes(1);
  });

  it("does not submit if a fresh selected-chain read fails", async () => {
    setup();
    await selectAll();
    mocks.readPayoutOptions.mockRejectedValueOnce(new Error("Payout source unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Review selected payouts" }));
    await screen.findByText("Payout source unavailable");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it("resumes frozen calls without rebuilding amounts or destination state", async () => {
    mocks.getPendingBatch.mockReturnValue({
      label: "Send project payouts",
      completed: 1,
      total: 2,
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Resume saved payouts" }));
    await waitFor(() =>
      expect(mocks.runBatch).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "payouts:42161:99,8453:42", calls: [] }),
      ),
    );
    expect(mocks.readPayoutOptions).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Review selected payouts" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps pending execution distinct from completed payouts", async () => {
    mocks.runBatch.mockResolvedValue({ status: "pending", hashes: [] });
    setup();
    await selectAll();
    fireEvent.click(screen.getByRole("button", { name: "Review selected payouts" }));
    await screen.findByText(
      "Payouts are pending. Resume the saved batch to check destination progress.",
    );
    expect(screen.queryByText("Payout transactions confirmed on all selected chains.")).toBeNull();
  });
});
