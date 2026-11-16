import { PayerDeployForm } from "@/app/[slug]/components/v6/extras/PayerDeployForm";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmIsOpen, expectEveryWayOutRefused, findConfirm } from "./support/confirm";

const mocks = vi.hoisted(() => ({
  account: "0x0000000000000000000000000000000000000001",
  runBatch: vi.fn(),
  getPendingBatch: vi.fn(),
  readContract: vi.fn(),
  getTransactionReceipt: vi.fn(),
  toast: vi.fn(),
  verifiedPairs: [] as { peerChainId: number; projectId: bigint }[],
  suckersVerified: true,
}));
vi.mock("@/lib/nana/suckers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nana/suckers")>()),
  useSuckers: () => ({
    verifiedPairs: mocks.verifiedPairs,
    isVerified: mocks.suckersVerified,
    isError: false,
  }),
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
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  formatWalletError: (error: Error) => error.message,
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
  mocks.verifiedPairs = [
    { peerChainId: 8453, projectId: 42n },
    { peerChainId: 42161, projectId: 99n },
  ];
  mocks.suckersVerified = true;
  mocks.getPendingBatch.mockReturnValue(undefined);
  mocks.runBatch.mockResolvedValue({ status: "pending", hashes: [] });
  mocks.readContract.mockResolvedValue(directory);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("sucker pairs the payer forwards to", () => {
  it("wallet-action:project-payer will not deploy for a chain whose project id the sucker registry does not list", async () => {
    // The indexer said project 99 on Arbitrum; the registry lists 100 there.
    mocks.verifiedPairs = [
      { peerChainId: 8453, projectId: 42n },
      { peerChainId: 42161, projectId: 100n },
    ];
    setup();
    expect(screen.getByText("The Arbitrum project listed here isn't linked onchain.")).toBeTruthy();
    const deploy = screen.getByRole("button", { name: "Deploy payer addresses" });
    expect(deploy).toBeDisabled();
    fireEvent.click(deploy);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it("wallet-action:project-payer will not resume a saved deployment whose unsent call targets an unlisted pair", async () => {
    mocks.verifiedPairs = [
      { peerChainId: 8453, projectId: 42n },
      { peerChainId: 42161, projectId: 100n },
    ];
    mocks.getPendingBatch.mockReturnValue({
      label: "Deploy payer addresses",
      completed: 1,
      total: 2,
      calls: [
        { chainId: 8453, state: "success", expectedDeployment: { projectId: "42" } },
        { chainId: 42161, state: "ready", expectedDeployment: { projectId: "99" } },
      ],
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Resume saved deployment" }));
    expect(
      await screen.findAllByText("The Arbitrum project listed here isn't linked onchain."),
    ).not.toHaveLength(0);
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it("waits for the registry read before a peer chain can be deployed", () => {
    mocks.verifiedPairs = [{ peerChainId: 8453, projectId: 42n }];
    mocks.suckersVerified = false;
    setup();
    expect(screen.queryByText(/belongs to this project|isn.t linked/)).toBeNull();
    expect(screen.getByRole("button", { name: "Deploy payer addresses" })).toBeDisabled();
  });
});

describe("multichain deployment form", () => {
  it("wallet-action:project-payer freezes all selected factory calls with unique project IDs, per-chain beneficiaries, settings and factory directory evidence", async () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Original payer" }));
    fireEvent.change(screen.getByLabelText("Beneficiary address"), {
      target: { value: beneficiary },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Set the beneficiary per chain" }));
    fireEvent.change(screen.getByLabelText("beneficiary on Arbitrum"), {
      target: { value: peerBeneficiary },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Editable" }));
    fireEvent.change(screen.getByLabelText("Admin address"), { target: { value: owner } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Add a memo to payments" }));
    fireEvent.change(screen.getByLabelText("Default memo"), {
      target: { value: " across chains " },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Custom metadata" }));
    fireEvent.change(screen.getByLabelText("Default metadata"), { target: { value: "0x1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer addresses" }));
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Arbitrum" }));
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer address" }));
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

  it("resumes saved progress before reading factories or rebuilding changed form settings", async () => {
    mocks.getPendingBatch.mockReturnValue({
      label: "Deploy payer addresses",
      completed: 1,
      total: 2,
    });
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Add a memo to payments" }));
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Arbitrum" }));
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer address" }));
    const link = await screen.findByRole("link", { name: "Verified deployment transaction" });
    expect(link.getAttribute("href")).toContain(hash);
    expect(onDeployed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Temporary display RPC failure")).toBeNull();
  });

  it("refuses every way out while the deployment runs, then closes once it lands", async () => {
    let finish!: (outcome: unknown) => void;
    mocks.runBatch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Deploy payer addresses" }));
    const confirm = await findConfirm();
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(1));

    expectEveryWayOutRefused(confirm);

    finish({ status: "success", hashes: [] });
    await waitFor(() => expect(confirmIsOpen()).toBe(false));
    expect(await screen.findByText(/Payer address deployment complete/)).toBeInTheDocument();
    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
  });
});
