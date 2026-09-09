import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Address, Hash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TokenState = {
  chainId: number;
  projectId: bigint;
  controller: Address;
  owner: Address;
  token: Address | null;
  name: string | null;
  symbol: string | null;
};

const mocks = vi.hoisted(() => ({
  chainId: 8453,
  safe: false,
  safeProposal: false,
  states: [] as TokenState[],
  refetch: vi.fn(),
  toast: vi.fn(),
  writeContractAsync: vi.fn(),
  switchChainAsync: vi.fn(),
  estimateContractGas: vi.fn(),
  waitForReceiptWithRetry: vi.fn(),
  getRelayrTxQuote: vi.fn(),
  sendRelayrTx: vi.fn(),
  waitForRelayrBundle: vi.fn(),
  resetRelayr: vi.fn(),
}));

const ACCOUNT = `0x${"11".repeat(20)}` as Address;
const CONTROLLER = `0x${"22".repeat(20)}` as Address;
const TOKEN = `0x${"33".repeat(20)}` as Address;
const HASHES = ["aa", "bb", "cc"].map((byte) => `0x${byte.repeat(32)}` as Hash);
const PAYMENTS = [1, 8453].map((chain) => ({
  chain,
  amount: "0xde0b6b3a7640000",
  calldata: "0x",
  target: CONTROLLER,
}));
const QUOTE = { bundle_uuid: "token-bundle", payment_info: PAYMENTS };

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === "v6-token-panel" ? mocks.states : true,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: mocks.refetch,
  }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBContractContext: () => ({ projectId: 4n, contractAddress: () => CONTROLLER }),
  useJBProjectMetadataContext: () => ({ metadata: { data: { name: "Project token" } } }),
  useJBTokenContext: () => ({ token: { data: { name: "Project token", symbol: "PROJ" } } }),
}));
vi.mock("@/hooks/useViewedAccount", () => ({
  useViewedAccount: () => ({ address: ACCOUNT }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    targetChainId,
    loading: _loading,
    connectWalletText: _connectWalletText,
    ...props
  }: {
    children: React.ReactNode;
    targetChainId?: number;
    loading?: boolean;
    connectWalletText?: string;
  }) => (
    <button {...props} data-target-chain={targetChainId}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/EtherscanLink", () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnection: () => mocks.safe,
  submittedViaSafe: () => mocks.safeProposal,
  requireOnchainExecution: () => {
    if (mocks.safeProposal)
      throw new Error("Safe proposal is awaiting Safe approvals and execution.");
  },
  useWriteContract: () => ({ writeContractAsync: mocks.writeContractAsync }),
}));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({
    getRelayrTxQuote: mocks.getRelayrTxQuote,
    reset: mocks.resetRelayr,
  }),
  useSendRelayrTx: () => ({ sendRelayrTx: mocks.sendRelayrTx }),
  waitForRelayrBundle: mocks.waitForRelayrBundle,
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/waitForReceipt", () => ({
  waitForReceiptWithRetry: mocks.waitForReceiptWithRetry,
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: ACCOUNT, chainId: mocks.chainId }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: ACCOUNT, chainId: mocks.chainId }),
  getPublicClient: (_config: unknown, { chainId }: { chainId: number }) => ({
    chain: { id: chainId },
    estimateContractGas: mocks.estimateContractGas,
  }),
}));

import { V6TokenPanel } from "@/app/[slug]/components/v6/owners/V6TokenPanel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function openConfirmation(
  chains: number[],
  deployed = false,
  blocked = false,
  missingTokenChain?: number,
) {
  mocks.states = chains.map((chainId, index) => ({
    chainId,
    projectId: BigInt(index + 4),
    controller: CONTROLLER,
    owner: ACCOUNT,
    token: deployed && chainId !== missingTokenChain ? TOKEN : null,
    name: deployed ? "Project token" : null,
    symbol: deployed ? "PROJ" : null,
  }));
  render(
    <V6TokenPanel
      projects={
        mocks.states.map(({ chainId, projectId }) => ({
          chainId,
          projectId: Number(projectId),
          token: TOKEN,
        })) as React.ComponentProps<typeof V6TokenPanel>["projects"]
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: deployed ? "Edit" : "Deploy ERC-20" }));
  fireEvent.click(
    await screen.findByRole("button", { name: deployed ? "Save token" : "Deploy token" }),
  );
  if (!blocked) {
    await screen.findByText(deployed ? "Confirm token update" : "Confirm token deployment");
  }
}

beforeEach(() => {
  mocks.chainId = 8453;
  mocks.safe = false;
  mocks.safeProposal = false;
  mocks.states = [];
  mocks.estimateContractGas.mockResolvedValue(100_000n);
  mocks.getRelayrTxQuote.mockResolvedValue(QUOTE);
  mocks.sendRelayrTx.mockResolvedValue(HASHES[0]);
  mocks.waitForRelayrBundle.mockResolvedValue(undefined);
  mocks.waitForReceiptWithRetry.mockResolvedValue({ status: "success" });
  mocks.refetch.mockResolvedValue(undefined);
  mocks.switchChainAsync.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.chainId = chainId;
  });
  mocks.writeContractAsync.mockImplementation(
    async () => HASHES[mocks.writeContractAsync.mock.calls.length - 1],
  );
});

describe("token panel Relayr funding", () => {
  it.each([false, true])(
    "relays all four testnets for token management (deployed: %s)",
    async (deployed) => {
      const chains = [11155111, 11155420, 84532, 421614];
      const payments = PAYMENTS.map((payment, index) => ({
        ...payment,
        chain: index ? 84532 : 11155111,
      }));
      mocks.chainId = 11155420;
      mocks.getRelayrTxQuote.mockResolvedValue({ ...QUOTE, payment_info: payments });
      await openConfirmation(chains, deployed);
      const picker = await screen.findByRole("combobox");
      const confirm = screen.getByRole("button", { name: "Pay and submit" });
      expect(confirm).toBeDisabled();
      expect(mocks.getRelayrTxQuote.mock.calls[0][0]).toEqual(
        chains.map((chainId, index) =>
          expect.objectContaining({
            chainId,
            review: expect.objectContaining({
              functionName: deployed ? "setTokenMetadataOf" : "deployERC20For",
            }),
            data: expect.objectContaining({ to: mocks.states[index].controller }),
          }),
        ),
      );
      expect(mocks.writeContractAsync).not.toHaveBeenCalled();
      fireEvent.click(picker);
      fireEvent.click(screen.getByRole("option", { name: /ETH on Base Sepolia/ }));
      fireEvent.click(confirm);
      await waitFor(() => expect(mocks.sendRelayrTx).toHaveBeenCalledExactlyOnceWith(payments[1]));
      expect(mocks.waitForRelayrBundle).toHaveBeenCalledExactlyOnceWith(QUOTE.bundle_uuid);
    },
  );

  it("requires a funding selection and waits for the funded bundle before reporting success", async () => {
    mocks.chainId = 10;
    const bundle = deferred<void>();
    mocks.waitForRelayrBundle.mockReturnValue(bundle.promise);
    await openConfirmation([1, 8453]);

    const picker = await screen.findByRole("combobox");
    const confirm = screen.getByRole("button", { name: "Pay and submit" });
    expect(picker).toHaveTextContent("Select chain");
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
    expect(mocks.getRelayrTxQuote.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        chainId: 1,
        review: expect.objectContaining({ functionName: "deployERC20For" }),
      }),
      expect.objectContaining({
        chainId: 8453,
        review: expect.objectContaining({ functionName: "deployERC20For" }),
      }),
    ]);

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: /1\.00000000 ETH on Base/ }));
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveAttribute("data-target-chain", "8453");
    expect(screen.getByText("Pay 1.00000000 ETH to relay")).toBeInTheDocument();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.sendRelayrTx).toHaveBeenCalledExactlyOnceWith(PAYMENTS[1]));
    expect(mocks.waitForRelayrBundle).toHaveBeenCalledExactlyOnceWith(QUOTE.bundle_uuid);
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();

    await act(async () => bundle.resolve());
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/Relayr confirmed.*2 chains/) }),
    );
  });

  it("retains the original funding preference when quote signing switches chains", async () => {
    mocks.getRelayrTxQuote.mockImplementation(async () => {
      mocks.chainId = 1;
      return QUOTE;
    });
    await openConfirmation([1, 8453], true);
    const picker = await screen.findByRole("combobox");
    await waitFor(() => expect(picker).toHaveTextContent("1.00000000 ETH on Base"));
    const confirm = screen.getByRole("button", { name: "Pay and submit" });
    expect(confirm).toHaveAttribute("data-target-chain", "8453");
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.sendRelayrTx).toHaveBeenCalledExactlyOnceWith(PAYMENTS[1]));
  });

  it("allows returning to the editor without funding the quote", async () => {
    await openConfirmation([1, 8453]);
    await screen.findByRole("combobox");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByLabelText("Token name")).toBeInTheDocument();
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });
});

describe("wallet-action:token-admin — token panel direct routing", () => {
  it.each([
    { label: "one deployment chain", chains: [1], safe: false, deployed: false },
    {
      label: "metadata across mainnets and testnets",
      chains: [1, 11155111],
      safe: false,
      deployed: true,
    },
    { label: "metadata with a Safe wallet", chains: [1, 8453], safe: true, deployed: true },
    {
      label: "testnet metadata with a Safe wallet",
      chains: [11155111, 84532],
      safe: true,
      deployed: true,
    },
  ])("reviews $label before submitting direct transactions", async ({ chains, safe, deployed }) => {
    mocks.safe = safe;
    await openConfirmation(chains, deployed);
    const confirm = screen.getByRole("button", { name: deployed ? "Save token" : "Deploy token" });
    expect(confirm).not.toBeDisabled();
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
    expect(mocks.writeContractAsync.mock.calls.map(([call]) => call.chainId)).toEqual(chains);
    expect(mocks.waitForReceiptWithRetry).toHaveBeenCalledTimes(chains.length);
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
  });

  it.each([
    { label: "mixed mainnets and testnets", chains: [1, 11155111], safe: false },
    { label: "an unsupported mainnet", chains: [1, 137], safe: false },
    { label: "a Safe wallet", chains: [1, 8453], safe: true },
    { label: "a testnet Safe wallet", chains: [11155111, 84532], safe: true },
  ])(
    "blocks multi-chain deployment for $label before any transaction",
    async ({ chains, safe }) => {
      mocks.safe = safe;
      await openConfirmation(chains, false, true);
      expect(
        await screen.findByText(/Choose one chain at a time to deploy an ERC-20/),
      ).toBeInTheDocument();
      expect(mocks.writeContractAsync).not.toHaveBeenCalled();
      expect(mocks.switchChainAsync).not.toHaveBeenCalled();
      expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
      expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
    },
  );

  it("blocks a direct batch when an ERC-20 is missing on only one chain", async () => {
    await openConfirmation([1, 11155111], true, true, 11155111);
    expect(
      await screen.findByText(/Choose one chain at a time to deploy an ERC-20/),
    ).toBeInTheDocument();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.switchChainAsync).not.toHaveBeenCalled();
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
  });

  it("waits for each receipt before the next write and switches back to the original chain", async () => {
    const first = deferred<{ status: string }>();
    const last = deferred<{ status: string }>();
    mocks.waitForReceiptWithRetry
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ status: "success" })
      .mockReturnValueOnce(last.promise);
    await openConfirmation([1, 11155111, 8453], true);
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));

    await waitFor(() => expect(mocks.waitForReceiptWithRetry).toHaveBeenCalledOnce());
    expect(mocks.writeContractAsync).toHaveBeenCalledOnce();
    expect(mocks.waitForReceiptWithRetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ chain: { id: 1 } }),
      HASHES[0],
    );
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();

    await act(async () => first.resolve({ status: "success" }));
    await waitFor(() => expect(mocks.waitForReceiptWithRetry).toHaveBeenCalledTimes(3));
    expect(mocks.switchChainAsync.mock.calls.map(([call]) => call.chainId)).toEqual([
      1, 11155111, 8453,
    ]);
    expect(mocks.writeContractAsync.mock.calls.map(([call]) => call.functionName)).toEqual([
      "setTokenMetadataOf",
      "setTokenMetadataOf",
      "setTokenMetadataOf",
    ]);
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();

    await act(async () => last.resolve({ status: "success" }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Token updated" }));
  });

  it("stops on a reverted later receipt without reporting the batch as complete", async () => {
    mocks.waitForReceiptWithRetry
      .mockResolvedValueOnce({ status: "success" })
      .mockResolvedValueOnce({ status: "reverted" });
    await openConfirmation([1, 11155111, 8453], true);
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));

    expect(await screen.findByText(/reverted on/i)).toBeInTheDocument();
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(2);
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("stops after a Safe proposal and leaves the batch awaiting execution", async () => {
    mocks.safe = true;
    mocks.safeProposal = true;
    await openConfirmation([1, 8453], true);
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));

    await waitFor(() => expect(mocks.writeContractAsync).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(`${document.body.textContent} ${JSON.stringify(mocks.toast.mock.calls)}`).toMatch(
        /awaiting Safe|Safe proposal|Safe approvals/i,
      ),
    );
    expect(mocks.waitForReceiptWithRetry).not.toHaveBeenCalled();
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Token updated" }),
    );
  });
});
