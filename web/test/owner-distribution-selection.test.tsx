import { V6AutoIssuanceSubtab } from "@/app/[slug]/components/v6/owners/V6AutoIssuanceSubtab";
import { V6ClaimCreditsDialog } from "@/app/[slug]/components/v6/owners/accounts/V6ClaimCreditsDialog";
import type { ProjectItem } from "@/app/[slug]/components/v6/shared";
import { DistributeReservedTokensButton } from "@/app/[slug]/owners/components/DistributeReservedTokensButton";
import { OwnerDistributionBatchButton } from "@/app/[slug]/owners/components/OwnerDistributionBatchButton";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: "0x0000000000000000000000000000000000000001",
  runBatch: vi.fn(),
  getPendingBatch: vi.fn(),
  prepareReserved: vi.fn(),
  prepareCredit: vi.fn(),
  prepareAuto: vi.fn(),
  stored: [] as Array<Record<string, unknown>>,
  issued: [] as Array<Record<string, unknown>>,
  unavailable: false,
  refetch: vi.fn(),
}));
const holder = "0x0000000000000000000000000000000000000001";
const beneficiary = "0x0000000000000000000000000000000000000002";

vi.mock("@/hooks/useMultichainBatch", () => ({
  useMultichainBatch: () => ({ runBatch: state.runBatch, getPendingBatch: state.getPendingBatch }),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: state.account, chainId: 10 }) }));
vi.mock("wagmi/actions", () => ({ getPublicClient: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBContractContext: () => ({ contractAddress: () => holder }),
  useJBTokenContext: () => ({ token: { data: { symbol: "REV" } } }),
}));
vi.mock("@/lib/utils", () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(" "),
  formatTokenSymbol: () => "REV",
  formatWalletError: (cause: Error) => cause.message,
}));
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/EtherscanLink", () => ({ default: () => null }));
vi.mock("@/components/loading/LoadingSkeletons", () => ({
  TableSkeleton: () => <div>Loading allocations</div>,
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/TxConfirmDialog", () => ({
  TxConfirmDialog: ({
    open,
    title,
    children,
    action,
    onConfirm,
    error,
    onOpenChange,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
    action: string;
    onConfirm: () => void;
    error?: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <section aria-label={title}>
        {children}
        {error ? <p role="alert">{error}</p> : null}
        <button onClick={onConfirm}>{action}</button>
        <button onClick={() => onOpenChange(false)}>Close review</button>
      </section>
    ) : null,
  SummaryRow: ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      {label}: {children}
    </div>
  ),
}));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogTrigger: Part,
    DialogContent: Part,
    DialogHeader: Part,
    DialogTitle: Part,
    DialogDescription: Part,
  };
});
vi.mock("@/hooks/useAllRulesetsByChain", () => ({
  useAllRulesetsByChain: () => ({
    data: { 10: [{ id: 101, start: 1 }] },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteStoredAutoIssuances: () => ({
    data: state.stored,
    isLoading: false,
    isError: state.unavailable,
    refetch: state.refetch,
  }),
  useCompleteAutoIssueEvents: () => ({
    data: state.issued,
    isLoading: false,
    isError: false,
    refetch: state.refetch,
  }),
}));
vi.mock("@/app/[slug]/owners/components/ownerDistributionBatch", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareReservedDistribution: (...args: unknown[]) => state.prepareReserved(...args),
  prepareCreditClaim: (...args: unknown[]) => state.prepareCredit(...args),
  prepareAutoIssuance: (...args: unknown[]) => state.prepareAuto(...args),
}));

function snapshot(chainId = 10, projectId = 91n, id = `${chainId}:${projectId}`) {
  return {
    id,
    chainId: chainId as 10,
    projectId,
    amount: 700n,
    details: [],
    call: {
      chainId: chainId as 10,
      address: holder as `0x${string}`,
      abi: [],
      functionName: "sendReservedTokensToSplitsOf",
      args: [projectId],
      contractName: "JBController",
      preconditions: [],
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.account = holder;
  state.stored = [];
  state.issued = [];
  state.unavailable = false;
  state.getPendingBatch.mockReturnValue(undefined);
  state.runBatch.mockResolvedValue({ status: "success", hashes: [] });
  state.prepareReserved.mockImplementation(async (_client, row) =>
    snapshot(row.chainId, row.projectId),
  );
  state.prepareCredit.mockImplementation(async (_client, row) =>
    snapshot(row.chainId, row.projectId),
  );
  state.prepareAuto.mockImplementation(async (_client, row) =>
    snapshot(
      row.chainId,
      row.projectId,
      `${row.chainId}:${row.projectId}:${row.stageId}:${row.beneficiary}`,
    ),
  );
});

describe("wallet-action:owner-distributions", () => {
  it("carries every selected allocation when multiple calls have the same chain", async () => {
    const first = snapshot(10, 91n, "allocation-1");
    const second = snapshot(10, 91n, "allocation-2");
    second.call.args = [92n];
    render(
      <OwnerDistributionBatchButton
        label="Distribute"
        scope="test"
        tokenSymbol="REV"
        prepare={async () => [first, second]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Distribute" }));
    await screen.findByRole("button", { name: "Confirm selected" });
    expect(state.runBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm selected" }));
    await waitFor(() =>
      expect(state.runBatch).toHaveBeenCalledWith(
        expect.objectContaining({ calls: [first.call, second.call] }),
      ),
    );
  });

  it("does not offer confirmation when any selected destination is unreadable", async () => {
    render(
      <OwnerDistributionBatchButton
        label="Distribute"
        scope="test"
        tokenSymbol="REV"
        prepare={async () => {
          throw new Error("Optimism RPC unavailable");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Distribute" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Optimism RPC unavailable");
    expect(state.runBatch).not.toHaveBeenCalled();
  });

  it("resumes a saved batch without rereading already consumed balances", async () => {
    state.getPendingBatch.mockReturnValue({ label: "Distribute", total: 3, completed: 2 });
    const prepare = vi.fn(async () => {
      throw new Error("already consumed");
    });
    render(
      <OwnerDistributionBatchButton
        label="Distribute"
        scope="test"
        tokenSymbol="REV"
        disabled
        prepare={prepare}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume saved batch (2/3 confirmed)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(state.runBatch).toHaveBeenCalledWith(
        expect.objectContaining({ calls: [], scope: "test" }),
      ),
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it("retries the frozen calls after a pending result", async () => {
    state.runBatch.mockResolvedValueOnce({ status: "pending", hashes: [] });
    const prepare = vi.fn(async () => [snapshot()]);
    render(
      <OwnerDistributionBatchButton
        label="Distribute"
        scope="test"
        tokenSymbol="REV"
        prepare={prepare}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Distribute" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(state.runBatch).toHaveBeenCalledTimes(2));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(state.runBatch.mock.calls[1][0].calls).toEqual(state.runBatch.mock.calls[0][0].calls);
  });

  it("requires the original account after review", async () => {
    const props = {
      label: "Distribute",
      scope: "test",
      tokenSymbol: "REV",
      prepare: async () => [snapshot()],
    };
    const view = render(<OwnerDistributionBatchButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Distribute" }));
    await screen.findByRole("button", { name: "Confirm selected" });
    state.account = beneficiary;
    view.rerender(<OwnerDistributionBatchButton {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm selected" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("connected account changed");
    expect(state.runBatch).not.toHaveBeenCalled();
  });

  it("reprepares changed state after an untouched draft is safely discarded", async () => {
    state.runBatch.mockRejectedValueOnce(new Error("The reviewed balance changed"));
    const prepare = vi.fn(async () => [snapshot()]);
    render(
      <OwnerDistributionBatchButton
        label="Distribute"
        scope="test"
        tokenSymbol="REV"
        prepare={prepare}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Distribute" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm selected" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("reviewed balance changed");
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Distribute" }));
    await screen.findByRole("button", { name: "Confirm selected" });
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});

describe("selected owner action destinations", () => {
  it("prepares only the checked reserve destinations with their own project IDs", async () => {
    render(
      <DistributeReservedTokensButton
        projects={[
          { chainId: 10, projectId: 91n, pending: 10n },
          { chainId: 8453, projectId: 12n, pending: 20n },
        ]}
        tokenSymbol="REV"
      />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Distribute selected pending splits" }));
    await screen.findByRole("button", { name: "Confirm selected" });
    expect(state.prepareReserved).toHaveBeenCalledTimes(1);
    expect(state.prepareReserved).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ chainId: 8453, projectId: 12n }),
      holder,
    );
  });

  it("prepares only selected credit holders and keeps the stable project-group scope", async () => {
    render(
      <V6ClaimCreditsDialog
        batchScope="10:91|8453:12"
        creditRows={[
          { chainId: 10, projectId: 91n, credit: 20n },
          { chainId: 8453, projectId: 12n, credit: 30n },
        ]}
        tokenSymbol="REV"
      >
        <button>Open claims</button>
      </V6ClaimCreditsDialog>,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Claim selected credits" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm selected" }));
    expect(state.prepareCredit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ chainId: 10, projectId: 91n }),
      holder,
    );
    await waitFor(() =>
      expect(state.runBatch).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "claim-credits:10:91|8453:12" }),
      ),
    );
  });

  it("keeps saved credit recovery reachable with no new balances", () => {
    state.getPendingBatch.mockReturnValue({ label: "Claim", total: 2, completed: 1 });
    render(
      <V6ClaimCreditsDialog batchScope="10:91|8453:12" creditRows={[]} tokenSymbol="REV">
        <button>Open claims</button>
      </V6ClaimCreditsDialog>,
    );
    expect(
      screen.getByRole("button", { name: "Resume saved batch (1/2 confirmed)" }),
    ).toBeEnabled();
  });

  it("retains two distinct beneficiaries on one chain and combines duplicate stored allocation events", async () => {
    state.stored = [
      {
        id: "a",
        version: 6,
        chainId: 10,
        projectId: 91,
        stageId: "101",
        beneficiary: holder,
        count: "100",
      },
      {
        id: "b",
        version: 6,
        chainId: 10,
        projectId: 91,
        stageId: "101",
        beneficiary,
        count: "200",
      },
      {
        id: "c",
        version: 6,
        chainId: 10,
        projectId: 91,
        stageId: "101",
        beneficiary: holder,
        count: "300",
      },
    ];
    render(<V6AutoIssuanceSubtab projects={[{ chainId: 10, projectId: 91 }] as ProjectItem[]} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Distribute selected auto issuances" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm selected" }));
    expect(state.prepareAuto).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(state.runBatch.mock.calls[0][0].calls).toHaveLength(2));
  });

  it("does not hide saved auto issuance recovery when indexer data fails", () => {
    state.unavailable = true;
    state.getPendingBatch.mockReturnValue({ label: "Auto issue", total: 2, completed: 1 });
    render(<V6AutoIssuanceSubtab projects={[{ chainId: 10, projectId: 91 }] as ProjectItem[]} />);
    expect(
      screen.getByRole("button", { name: "Resume saved batch (1/2 confirmed)" }),
    ).toBeEnabled();
  });
});
