import { FundComputeProject } from "@/components/telligence/FundComputeProject";
import { VVV_ADDRESS } from "@/lib/telligence/transactions";
import type { ProjectSnapshot } from "@/lib/telligence/types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111",
  gateway: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  receipt: vi.fn(),
  preview: vi.fn(),
  refresh: vi.fn(),
  reverify: undefined as undefined | (() => Promise<void>),
  beforeSubmission: undefined as undefined | (() => Promise<void>),
  requireExecution: vi.fn(),
  activity: vi.fn(),
  updateActivity: vi.fn(),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: m.address }), useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({ getAccount: () => ({ address: m.address }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  useWriteContract: (options: {
    reverify: () => Promise<void>;
    beforeSubmission: () => Promise<void>;
  }) => {
    m.reverify = options.reverify;
    m.beforeSubmission = options.beforeSubmission;
    return {
      writeContractAsync: async (tx: unknown) => {
        await m.reverify?.();
        return m.write(tx);
      },
    };
  },
  requireOnchainExecution: (...args: unknown[]) => m.requireExecution(...args),
}));
vi.mock("@/lib/telligence/api", () => ({
  gatewayRequest: (...args: unknown[]) => m.gateway(...args),
}));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: () => ({ readContract: (...args: unknown[]) => m.read(...args) }),
}));
vi.mock("@/lib/waitForReceipt", () => ({
  waitForReceiptWithRetry: (...args: unknown[]) => m.receipt(...args),
}));
vi.mock("@/lib/transaction-activity", () => ({
  transactionActivityForHash: (...args: unknown[]) => m.activity(...args),
  updateTransactionActivity: (...args: unknown[]) => m.updateActivity(...args),
}));
vi.mock("@/lib/view-as", () => ({ requireNoViewAs: vi.fn() }));
vi.mock("@bananapus/nana-sdk-core/v6", async (original) => ({
  ...(await original<object>()),
  previewPay: (...args: unknown[]) => m.preview(...args),
}));
const policy = "0x2222222222222222222222222222222222222222";
const vault = "0x3333333333333333333333333333333333333333";
const terminal = "0x4444444444444444444444444444444444444444";
const factory = "0x5555555555555555555555555555555555555555";
const hash = `0x${"ab".repeat(32)}`;
const config = {
  ready: true,
  policyVersion: "2" as const,
  chainId: 8453,
  factoryAddress: factory,
  canonicalTerminal: terminal,
  vvvAddress: VVV_ADDRESS,
};
const project = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  chainId: 8453,
  revnetId: "12",
  wrapperAddress: policy,
  vaultAddress: vault,
  creatorAddress: "0x1111111111111111111111111111111111111111",
  status: "active",
  name: "Public archive",
  purpose: "Make historical research accessible to everyone.",
  workload: "Search records",
  targetDailyCreditUsd: "10",
  createdAt: "2026-09-09T00:00:00Z",
  capacity: {
    status: "ready",
    dailyCreditUsd: "10",
    remainingCreditUsd: "10",
    observedAt: "2026-09-09T12:00:00Z",
  },
  policyVersion: "1",
} satisfies ProjectSnapshot;
const payEvent = parseAbi([
  "event Pay(uint256 indexed rulesetId,uint256 indexed rulesetCycleNumber,uint256 indexed projectId,address payer,address beneficiary,uint256 amount,uint256 newlyIssuedTokenCount,string memo,bytes metadata,address caller)",
]);
function paidReceipt() {
  const supporter = project.creatorAddress;
  return {
    status: "success",
    logs: [
      {
        address: terminal,
        topics: encodeEventTopics({
          abi: payEvent,
          eventName: "Pay",
          args: { rulesetId: 1n, rulesetCycleNumber: 1n, projectId: 12n },
        }),
        data: encodeAbiParameters(
          [
            { type: "address" },
            { type: "address" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "string" },
            { type: "bytes" },
            { type: "address" },
          ],
          [
            supporter,
            supporter,
            2n * 10n ** 18n,
            12n * 10n ** 18n,
            "Support compute",
            "0x",
            supporter,
          ],
        ),
      },
    ],
  };
}
function contribute() {
  fireEvent.change(screen.getByLabelText(/Contribution/), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Fund compute" }));
}
beforeEach(() => {
  localStorage.clear();
  m.address = project.creatorAddress;
  m.reverify = undefined;
  m.gateway.mockResolvedValue(config);
  m.write.mockResolvedValue(hash);
  m.receipt.mockResolvedValue(paidReceipt());
  m.preview.mockResolvedValue({
    beneficiaryTokenCount: 12n * 10n ** 18n,
    reservedTokenCount: 8n * 10n ** 18n,
  });
  m.read.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      ({
        policyOf: policy,
        vaultOf: vault,
        creatorOf: project.creatorAddress,
        TERMINAL: terminal,
        state: 0,
        allowance: 0n,
        balanceOf: 10n ** 20n,
      })[functionName as "state"],
  );
});
describe("wallet-action:telligence-funding reviewed compute contributions", () => {
  it.each(["1", "2"])(
    "approves exactly the amount and pays the stock terminal for policy version %s",
    async (policyVersion) => {
      m.gateway.mockResolvedValue({ ...config, policyVersion });
      render(<FundComputeProject project={project} />);
      contribute();
      await screen.findByText(/Contribution confirmed/);
      expect(m.write).toHaveBeenCalledTimes(2);
      expect(m.write.mock.calls[0][0]).toMatchObject({
        address: VVV_ADDRESS,
        functionName: "approve",
        args: [terminal, 2n * 10n ** 18n],
      });
      expect(m.write.mock.calls[1][0]).toMatchObject({ address: terminal, functionName: "pay" });
      expect(m.preview.mock.invocationCallOrder[0]).toBeGreaterThan(
        m.receipt.mock.invocationCallOrder[0],
      );
    },
  );
  it("rejects a substituted terminal before any token approval", async () => {
    m.gateway.mockResolvedValue({ ...config, canonicalTerminal: factory });
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByRole("alert");
    expect(m.write).not.toHaveBeenCalled();
  });
  it("does not ask for a wallet transaction after navigating away during preparation", async () => {
    let resolve!: (value: unknown) => void;
    m.gateway.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<FundComputeProject project={project} />);
    contribute();
    await waitFor(() => expect(m.gateway).toHaveBeenCalled());
    view.unmount();
    await act(async () => {
      resolve(config);
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(m.write).not.toHaveBeenCalled();
  });
  it("stops before payment if the connected wallet changes after approval", async () => {
    m.receipt.mockImplementation(async () => {
      m.address = factory;
      return { status: "success" };
    });
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByRole("alert");
    expect(m.write).toHaveBeenCalledTimes(1);
    expect(m.preview).not.toHaveBeenCalled();
  });
  it("keeps an uncertain submitted payment and confirms it without paying again", async () => {
    m.receipt
      .mockResolvedValueOnce({ status: "success" })
      .mockRejectedValueOnce(new Error("Receipt temporarily unavailable"));
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByRole("alert");
    expect(m.write).toHaveBeenCalledTimes(2);
    m.receipt.mockResolvedValue(paidReceipt());
    fireEvent.click(screen.getByRole("button", { name: "Resume contribution" }));
    await screen.findByText(/Contribution confirmed/);
    expect(m.write).toHaveBeenCalledTimes(2);
  });
  it("retains a Safe outer success with no matching Pay event for recovery", async () => {
    m.receipt
      .mockResolvedValueOnce({ status: "success", logs: [] })
      .mockResolvedValueOnce({ status: "success", logs: [] });
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByRole("alert");
    expect(screen.queryByText(/Contribution confirmed/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume contribution" })).toBeInTheDocument();
    expect(localStorage.getItem(`telligence:fund:8453:${project.id}:${m.address}`)).not.toBeNull();
  });

  it("never ignores an empty saved contribution record", async () => {
    localStorage.setItem(`telligence:fund:8453:${project.id}:${m.address}`, "");
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByRole("alert");
    expect(m.write).not.toHaveBeenCalled();
    expect(localStorage.getItem(`telligence:fund:8453:${project.id}:${m.address}`)).toBe("");
  });

  it("confirms a saved payment from immutable onchain policy while the gateway is unavailable", async () => {
    localStorage.setItem(
      `telligence:fund:8453:${project.id}:${m.address}`,
      JSON.stringify({
        hash,
        step: "payment",
        amount: "2",
        creator: m.address,
        projectId: project.id,
      }),
    );
    m.gateway.mockRejectedValue(new Error("Gateway unavailable"));
    render(<FundComputeProject project={project} />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume contribution" }));
    await screen.findByText(/Contribution confirmed/);
    expect(m.gateway).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
    expect(m.read).toHaveBeenCalledWith(
      expect.objectContaining({ address: policy, functionName: "TERMINAL" }),
    );
  });

  it("keeps an asynchronous Safe approval and resumes without another approval", async () => {
    m.requireExecution.mockImplementationOnce(() => {
      throw new Error("Safe approval awaiting execution");
    });
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByRole("alert");
    expect(m.write).toHaveBeenCalledTimes(1);
    const original = m.read.getMockImplementation()!;
    m.read.mockImplementation(async (arg) =>
      arg.functionName === "allowance" ? 2n * 10n ** 18n : original(arg),
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume contribution" }));
    await screen.findByText(/Contribution confirmed/);
    expect(m.write).toHaveBeenCalledTimes(2);
    expect(m.write.mock.calls[1][0]).toMatchObject({ functionName: "pay" });
  });
});
