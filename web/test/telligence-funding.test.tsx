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
  run: vi.fn(),
  preview: vi.fn(),
  refresh: vi.fn(),
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
vi.mock("@/hooks/useReviewedAction", () => ({
  SAFE_PROPOSAL_PENDING_LINE: "This proposal is waiting in your Safe. Finish it there first.",
  failedLine: (result: { error: string }) => result.error,
  // The request and its hold options stand for the reviewed call.
  reviewedCall: (request: object, options: object) => ({ ...request, ...options }),
  useReviewedAction: () => ({ run: m.run }),
}));
vi.mock("@/lib/safe-connector", () => ({ isSafeConnection: () => false }));
vi.mock("@/lib/telligence/api", () => ({
  gatewayRequest: (...args: unknown[]) => m.gateway(...args),
}));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: () => ({ readContract: (...args: unknown[]) => m.read(...args) }),
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
  m.gateway.mockResolvedValue(config);
  m.run.mockReset();
  m.run.mockResolvedValue({ status: "done", hashes: [hash, hash], receipts: [{}, paidReceipt()] });
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
type Action = {
  account: string;
  calls: { address: string; functionName: string; args: unknown[]; dependsOnPrior?: boolean }[];
  scope?: string;
  reverify: () => Promise<void>;
  assertWriteState: () => void;
};
const action = () => m.run.mock.calls[0][0] as Action;

describe("wallet-action:telligence-funding reviewed compute contributions", () => {
  it.each(["1", "2"])(
    "reviews the exact approval and the stock terminal payment as one action for policy version %s",
    async (policyVersion) => {
      m.gateway.mockResolvedValue({ ...config, policyVersion });
      render(<FundComputeProject project={project} />);
      contribute();
      await screen.findByText(/Contribution confirmed/);
      expect(m.run).toHaveBeenCalledTimes(1);
      const { account, calls, scope } = action();
      expect(account).toBe(project.creatorAddress);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        address: VVV_ADDRESS,
        functionName: "approve",
        args: [terminal, 2n * 10n ** 18n],
      });
      expect(calls[1]).toMatchObject({
        address: terminal,
        functionName: "pay",
        dependsOnPrior: true,
      });
      // A two-step action resumes by its scope: the payment's own intent.
      expect(scope).toBeTruthy();
      expect(m.refresh).toHaveBeenCalled();
    },
  );
  it("sends the payment alone when the allowance already covers it", async () => {
    const original = m.read.getMockImplementation()!;
    m.read.mockImplementation(async (arg) =>
      arg.functionName === "allowance" ? 2n * 10n ** 18n : original(arg),
    );
    m.run.mockResolvedValue({ status: "done", hashes: [hash], receipts: [paidReceipt()] });
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByText(/Contribution confirmed/);
    expect(action().calls.map((call) => call.functionName)).toEqual(["pay"]);
    expect(action().scope).toBeUndefined();
  });
  it("rejects a substituted terminal before any review", async () => {
    m.gateway.mockResolvedValue({ ...config, canonicalTerminal: factory });
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByRole("alert");
    expect(m.run).not.toHaveBeenCalled();
  });
  it("does not ask for a review after navigating away during preparation", async () => {
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
    expect(m.run).not.toHaveBeenCalled();
  });
  it("refuses each step once the connected wallet changes", async () => {
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByText(/Contribution confirmed/);
    m.address = factory;
    expect(() => action().assertWriteState()).toThrow(/wallet changed/i);
    await expect(action().reverify()).rejects.toThrow(/wallet changed/i);
  });
  it("refuses each step once the backing starts winding down", async () => {
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByText(/Contribution confirmed/);
    const original = m.read.getMockImplementation()!;
    m.read.mockImplementation(async (arg) => (arg.functionName === "state" ? 1 : original(arg)));
    await expect(action().reverify()).rejects.toThrow(/winding down/i);
  });
  it("does not confirm a Safe outer success with no matching Pay event", async () => {
    m.run.mockResolvedValue({
      status: "done",
      hashes: [hash],
      receipts: [{ status: "success", logs: [] }],
    });
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByRole("alert");
    expect(screen.queryByText(/Contribution confirmed/)).not.toBeInTheDocument();
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it("keeps a Safe proposal pending instead of confirming the contribution", async () => {
    m.run.mockResolvedValue({ status: "proposed", step: 0, safeTxHash: hash });
    render(<FundComputeProject project={project} />);
    contribute();
    await screen.findByText(/waiting in your Safe/);
    expect(screen.queryByText(/Contribution confirmed/)).not.toBeInTheDocument();
  });
  it("shows a failed run's own line, and nothing for a closed review", async () => {
    m.run.mockResolvedValueOnce({ status: "failed", error: "Nothing was sent.", failure: null });
    render(<FundComputeProject project={project} />);
    contribute();
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was sent.");
    m.run.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Fund compute" }));
    await waitFor(() => expect(m.run).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.queryByText(/Contribution confirmed/)).not.toBeInTheDocument();
  });
});
