import { PayerDeployForm } from "@/app/[slug]/components/v6/extras/PayerDeployForm";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: "0x0000000000000000000000000000000000000001",
  runBatch: vi.fn(),
  getPendingBatch: vi.fn(),
  readContract: vi.fn(),
  getTransactionReceipt: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.account }) }));
vi.mock("wagmi/actions", () => ({
  getPublicClient: () => ({
    readContract: mocks.readContract,
    getTransactionReceipt: mocks.getTransactionReceipt,
  }),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/hooks/useMultichainBatch", () => ({
  useMultichainBatch: () => ({ runBatch: mocks.runBatch, getPendingBatch: mocks.getPendingBatch }),
}));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/utils", () => ({
  formatWalletError: (error: Error) => error.message,
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
  etherscanLink: (hash: string) => `https://example.test/tx/${hash}`,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    loading: _loading,
    connectWalletText: _connectWalletText,
    children,
    ...props
  }: ComponentProps<"button"> & { loading?: boolean; connectWalletText?: string }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/TxConfirmDialog", () => ({
  TxConfirmDialog: ({
    children,
    onConfirm,
    error,
    stepsIntro,
  }: {
    children: ReactNode;
    onConfirm: () => void;
    error: string | null;
    stepsIntro?: string;
  }) => (
    <div role="dialog">
      {children}
      <p>{stepsIntro}</p>
      <button onClick={onConfirm}>Confirm deployment</button>
      {error && <p role="alert">{error}</p>}
    </div>
  ),
  SummaryRow: ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      {label}
      {children}
    </div>
  ),
}));

const rows = [
  { chainId: 8453 as const, projectId: 42 },
  { chainId: 42161 as const, projectId: 99 },
];
const directory = "0x0000000000000000000000000000000000000011";
const beneficiary = "0x0000000000000000000000000000000000000012";
const peerBeneficiary = "0x0000000000000000000000000000000000000013";
const owner = "0x0000000000000000000000000000000000000014";
const onDeployed = vi.fn();
function setup() {
  return render(<PayerDeployForm rows={rows} existingRows={[]} onDeployed={onDeployed} />);
}

beforeEach(() => {
  mocks.account = "0x0000000000000000000000000000000000000001";
  mocks.getPendingBatch.mockReturnValue(undefined);
  mocks.runBatch.mockResolvedValue({ status: "pending", hashes: [] });
  mocks.readContract.mockResolvedValue(directory);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("wallet-action:project-payer — multichain deployment form", () => {
  it("freezes all selected factory calls with unique project IDs, per-chain beneficiaries, settings and factory directory evidence", async () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Original payer" }));
    fireEvent.change(screen.getByLabelText("Default beneficiary"), {
      target: { value: beneficiary },
    });
    fireEvent.change(screen.getByLabelText("beneficiary on Arbitrum One"), {
      target: { value: peerBeneficiary },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Editable" }));
    fireEvent.change(screen.getByLabelText("Address admin"), { target: { value: owner } });
    fireEvent.change(screen.getByLabelText("Default memo"), {
      target: { value: " across chains " },
    });
    fireEvent.change(screen.getByLabelText("Default metadata"), { target: { value: "0x1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer addresses" }));
    await screen.findByRole("dialog");
    expect(screen.getByText(/choose a funding chain/)).toBeTruthy();
    mocks.readContract.mockRejectedValue(new Error("Do not reread after review"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deployment" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(1));
    const batch = mocks.runBatch.mock.calls[0][0];
    expect(batch.scope).toBe("project-payers:42161:99,8453:42");
    expect(batch.calls).toMatchObject([
      {
        chainId: 8453,
        relayrMode: "raw",
        functionName: "deployProjectPayer",
        args: [42n, beneficiary, "across chains", "0x1234", false, owner],
        expectedDeployment: {
          kind: "project-payer",
          projectId: "42",
          beneficiary,
          memo: "across chains",
          metadata: "0x1234",
          addToBalance: false,
          owner,
          directory,
        },
      },
      {
        chainId: 42161,
        relayrMode: "raw",
        args: [99n, peerBeneficiary, "across chains", "0x1234", false, owner],
        expectedDeployment: { projectId: "99", beneficiary: peerBeneficiary, directory },
      },
    ]);
    expect(
      batch.calls.every(
        (call: { preconditions: { data: string }[] }) =>
          call.preconditions[0].data ===
          encodeFunctionData({
            abi: parseAbi(["function DIRECTORY() view returns(address)"]),
            functionName: "DIRECTORY",
          }),
      ),
    ).toBe(true);
    expect(mocks.readContract).toHaveBeenCalledTimes(2);
    expect(onDeployed).not.toHaveBeenCalled();
  });

  it("retains a single selected chain and immutable original-payer defaults", async () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Arbitrum One" }));
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer address" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Confirm deployment" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(1));
    expect(mocks.runBatch.mock.calls[0][0].calls).toMatchObject([
      { chainId: 8453, args: [42n, zeroAddress, "", "0x", false, zeroAddress] },
    ]);
    expect(mocks.runBatch.mock.calls[0][0].calls).toHaveLength(1);
  });

  it("fails before review if a selected factory directory cannot be verified", async () => {
    mocks.readContract.mockRejectedValueOnce(new Error("Factory unavailable"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer addresses" }));
    await screen.findByText("Factory unavailable");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it("does not submit a frozen deployment with a different account", async () => {
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer addresses" }));
    await screen.findByRole("dialog");
    mocks.account = owner;
    view.rerender(<PayerDeployForm rows={rows} existingRows={[]} onDeployed={onDeployed} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm deployment" }));
    await screen.findByText("Your connected account changed — review the deploy again.");
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it("resumes saved progress before reading factories or rebuilding changed form settings", async () => {
    mocks.getPendingBatch.mockReturnValue({
      label: "Deploy payer addresses",
      completed: 1,
      total: 2,
    });
    setup();
    fireEvent.change(screen.getByLabelText("Default memo"), {
      target: { value: "different draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume saved deployment" }));
    await waitFor(() =>
      expect(mocks.runBatch).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "project-payers:42161:99,8453:42", calls: [] }),
      ),
    );
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Deploy payer addresses" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps verified completion visible if the second display-only receipt fetch fails", async () => {
    const hash = `0x${"a".repeat(64)}`;
    mocks.runBatch.mockResolvedValue({
      status: "success",
      hashes: [{ chainId: 8453, hash, callIndex: 0 }],
    });
    mocks.getTransactionReceipt.mockRejectedValue(new Error("Temporary display RPC failure"));
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Arbitrum One" }));
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer address" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Confirm deployment" }));
    const link = await screen.findByRole("link", { name: "Verified deployment transaction" });
    expect(link.getAttribute("href")).toContain(hash);
    expect(onDeployed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Temporary display RPC failure")).toBeNull();
  });
});
