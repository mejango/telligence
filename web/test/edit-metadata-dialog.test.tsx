import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pinProjectMetadata: vi.fn(),
  refetch: vi.fn(),
  writeContractAsync: vi.fn(),
  switchChainAsync: vi.fn(),
  getRelayrTxQuote: vi.fn(),
  requireRelayrRecoveryScopeAvailable: vi.fn(),
  sendRelayrTx: vi.fn(),
  resetRelayr: vi.fn(),
  waitForRelayrBundle: vi.fn(),
  simulateContract: vi.fn(),
  waitForReceipt: vi.fn(),
  requireOnchainExecution: vi.fn(),
  safe: false,
  connectedChainId: 11155111,
  verifyMetadataSource: vi.fn(),
  peerMetadata: {} as Record<number, Record<string, unknown>>,
  controllers: {} as Record<number, string>,
  contractAddress: () => `0x${"11".repeat(20)}`,
  metadata: { data: undefined as unknown, isLoading: false } as {
    data: unknown;
    isLoading: boolean;
    refetch?: () => Promise<{ data?: unknown }>;
  },
}));

vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({
  pinProjectMetadata: mocks.pinProjectMetadata,
}));

vi.mock("@/lib/nana/project", () => ({
  useJBProjectMetadataContext: () => ({ metadata: mocks.metadata }),
  useJBContractContext: () => ({
    contractAddress: mocks.contractAddress,
  }),
  useJBChainId: () => 11155111,
}));

vi.mock("@/lib/project-metadata-write", () => ({
  readMetadataDestination: async (
    _client: unknown,
    identity: { chainId: number; projectId: string },
    account?: string,
  ) => {
    if (account) await mocks.verifyMetadataSource(_client, identity, account);
    const result = await mocks.refetch();
    return {
      source: {
        ...identity,
        controller: mocks.controllers[identity.chainId] ?? `0x${"11".repeat(20)}`,
        uri: "ipfs://source",
      },
      metadata: mocks.peerMetadata[identity.chainId] ?? result.data,
    };
  },
  verifyMetadataSource: mocks.verifyMetadataSource,
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

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnector: () => mocks.safe,
  requireOnchainExecution: mocks.requireOnchainExecution,
  submittedViaSafe: () => false,
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
  useWriteContract: () => ({
    data: undefined,
    isPending: false,
    writeContractAsync: mocks.writeContractAsync,
  }),
}));

vi.mock("@/hooks/useReviewedRelayr", () => ({
  requireRelayrRecoveryScopeAvailable: mocks.requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote: () => ({
    getRelayrTxQuote: mocks.getRelayrTxQuote,
    reset: mocks.resetRelayr,
  }),
  useSendRelayrTx: () => ({ sendRelayrTx: mocks.sendRelayrTx }),
  waitForRelayrBundle: mocks.waitForRelayrBundle,
}));

vi.mock("@/hooks/useTokenA", () => ({
  useTokenA: () => ({ symbol: "USDC", decimals: 6 }),
}));

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));

vi.mock("wagmi/actions", () => ({
  getPublicClient: (_config: unknown, { chainId }: { chainId: number }) => ({
    estimateContractGas: vi.fn().mockResolvedValue(100_000n),
    simulateContract: mocks.simulateContract,
    waitForTransactionReceipt: ({ hash }: { hash: string }) => mocks.waitForReceipt(chainId, hash),
  }),
  getAccount: () => ({ address: `0x${"22".repeat(20)}`, chainId: mocks.connectedChainId }),
  switchChain: (_config: unknown, parameters: unknown) => mocks.switchChainAsync(parameters),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: `0x${"22".repeat(20)}`, chainId: mocks.connectedChainId }),
  useChainId: () => 11155111,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { EditMetadataDialog } from "@/app/[slug]/about/components/EditMetadataDialog";

const CURRENT_METADATA = {
  name: "Current name",
  description: "Current description",
  logoUri: "ipfs://logo",
  leagueID: "l-1",
  tags: ["defi"],
};

const PROJECTS = [{ chainId: 11155111, projectId: 4, token: `0x${"33".repeat(20)}` }] as any;

function renderDialog(projects = PROJECTS) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EditMetadataDialog projects={projects} />
    </QueryClientProvider>,
  );
}

async function openDialog(projects = PROJECTS) {
  renderDialog(projects);
  fireEvent.click(screen.getByRole("button", { name: /edit metadata/i }));
  await screen.findByText("Advanced");
}

function advancedTextarea() {
  return screen.getByLabelText(/custom properties/i) as HTMLTextAreaElement;
}

/**
 * The advanced editor mounts before the authoritative metadata resolves, so
 * every test that reads or edits it must wait for the prefill to land instead
 * of racing the re-initialisation that would otherwise clobber the edit.
 */
async function prefilledAdvancedTextarea() {
  await waitFor(() => expect(advancedTextarea().value).toContain("leagueID"));
  return advancedTextarea();
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /^save changes$/i }));
}

async function pinnedMetadata() {
  await waitFor(() => expect(mocks.pinProjectMetadata).toHaveBeenCalled());
  return mocks.pinProjectMetadata.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  mocks.requireRelayrRecoveryScopeAvailable.mockImplementation(() => undefined);
  mocks.peerMetadata = {};
  mocks.controllers = {};
  mocks.verifyMetadataSource.mockResolvedValue(undefined);
  mocks.pinProjectMetadata.mockReset();
  mocks.pinProjectMetadata.mockResolvedValue("QmTFCRTLGXQZgPjNMLxRHfnTQpsvSNvzEpx6NKCcXgSTuA");
  mocks.writeContractAsync.mockReset();
  mocks.writeContractAsync.mockResolvedValue(`0x${"ab".repeat(32)}`);
  mocks.refetch.mockReset();
  mocks.refetch.mockResolvedValue({ data: CURRENT_METADATA });
  mocks.metadata.data = CURRENT_METADATA;
  mocks.metadata.refetch = mocks.refetch;
  mocks.connectedChainId = 11155111;
  mocks.safe = false;
  mocks.switchChainAsync.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.connectedChainId = chainId;
  });
  mocks.simulateContract.mockResolvedValue({});
  mocks.waitForReceipt.mockResolvedValue({ status: "success" });
  mocks.requireOnchainExecution.mockImplementation(() => undefined);
  mocks.sendRelayrTx.mockResolvedValue(`0x${"cd".repeat(32)}`);
  mocks.waitForRelayrBundle.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("EditMetadataDialog Relayr payment choice", () => {
  const projects = [
    { ...PROJECTS[0], chainId: 1 },
    { ...PROJECTS[0], chainId: 8453 },
  ];
  const payments = [1, 8453].map((chain) => ({
    chain,
    amount: "0xde0b6b3a7640000",
    calldata: "0x",
    target: `0x${"44".repeat(20)}`,
  }));
  const quote = { bundle_uuid: "metadata-bundle", payment_info: payments };

  it("relays all four testnet metadata destinations and waits for a testnet funding choice", async () => {
    const chainIds = [11155111, 11155420, 84532, 421614];
    const testnetPayments = payments.map((payment, index) => ({
      ...payment,
      chain: index ? 84532 : 11155111,
    }));
    mocks.connectedChainId = 10;
    mocks.getRelayrTxQuote.mockResolvedValue({ ...quote, payment_info: testnetPayments });
    await openDialog(
      chainIds.map((chainId, index) => ({ ...PROJECTS[0], chainId, projectId: index + 41 })),
    );
    await prefilledAdvancedTextarea();
    await save();
    const picker = await screen.findByRole("combobox");
    const confirm = screen.getByRole("button", { name: "Pay and submit" });
    expect(confirm).toBeDisabled();
    expect(mocks.getRelayrTxQuote.mock.calls[0][0]).toEqual(
      chainIds.map((chainId, index) =>
        expect.objectContaining({
          chainId,
          recoveryScope: `project-metadata:${chainId}:${index + 41}`,
          review: expect.objectContaining({
            functionName: "setUriOf",
            args: [BigInt(index + 41), expect.any(String)],
          }),
          metadataSource: expect.objectContaining({ chainId, projectId: String(index + 41) }),
        }),
      ),
    );
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: /ETH on Base Sepolia/ }));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.sendRelayrTx).toHaveBeenCalledExactlyOnceWith(testnetPayments[1]),
    );
    expect(mocks.waitForRelayrBundle).toHaveBeenCalledExactlyOnceWith(quote.bundle_uuid);
  });

  it("requires an explicit funding choice when the connected chain is not quoted", async () => {
    mocks.connectedChainId = 10;
    mocks.getRelayrTxQuote.mockResolvedValue(quote);
    await openDialog(projects);
    await prefilledAdvancedTextarea();
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute(
      "data-target-chain",
      "10",
    );
    await save();

    const picker = await screen.findByRole("combobox");
    expect(screen.getByText("Sign the authorization on Ethereum")).toBeInTheDocument();
    expect(screen.getByText("Sign the authorization on Base")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Pay and submit" });
    expect(picker).toHaveTextContent("Select chain");
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: /1\.00000000 ETH on Base/ }));
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveAttribute("data-target-chain", "8453");
    expect(screen.getByText("Pay 1.00000000 ETH to relay")).toBeInTheDocument();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.sendRelayrTx).toHaveBeenCalledWith(payments[1]));
  });

  it("prefers the originally connected chain even when quote signing changes the wallet chain", async () => {
    mocks.connectedChainId = 8453;
    mocks.getRelayrTxQuote.mockImplementation(async () => {
      mocks.connectedChainId = 1;
      return quote;
    });
    await openDialog(projects);
    await prefilledAdvancedTextarea();
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute(
      "data-target-chain",
      "8453",
    );
    await save();

    const picker = await screen.findByRole("combobox");
    await waitFor(() => expect(picker).toHaveTextContent("1.00000000 ETH on Base"));
    const confirm = screen.getByRole("button", { name: "Pay and submit" });
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveAttribute("data-target-chain", "8453");
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.sendRelayrTx).toHaveBeenCalledWith(payments[1]));
  });
});

describe("wallet-action:metadata — EditMetadataDialog direct routing", () => {
  it.each([
    { route: "testnet Safe", chainIds: [11155111, 84532], safe: true },
    { route: "mixed mainnet and testnet EOA", chainIds: [1, 84532], safe: false },
    { route: "mainnet Safe", chainIds: [1, 8453], safe: true },
  ])("waits for every receipt in order for $route metadata updates", async ({ chainIds, safe }) => {
    mocks.safe = safe;
    mocks.connectedChainId = chainIds[0];
    const projects = chainIds.map((chainId) => ({ ...PROJECTS[0], chainId }));
    let resolveFirst!: (receipt: { status: string }) => void;
    let resolveSecond!: (receipt: { status: string }) => void;
    const firstReceipt = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondReceipt = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    mocks.waitForReceipt.mockImplementation((chainId) =>
      chainId === chainIds[0] ? firstReceipt : secondReceipt,
    );

    await openDialog(projects);
    await prefilledAdvancedTextarea();
    await save();
    await screen.findByText("Confirm metadata");
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Save changes" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.waitForReceipt).toHaveBeenCalledTimes(1));
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.writeContractAsync.mock.calls[0][0]).toMatchObject({
      chainId: chainIds[0],
      functionName: "setUriOf",
    });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Confirm metadata")).toBeInTheDocument();

    await act(async () => resolveFirst({ status: "success" }));
    await waitFor(() => expect(mocks.waitForReceipt).toHaveBeenCalledTimes(2));
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(2);
    expect(mocks.writeContractAsync.mock.calls[1][0]).toMatchObject({
      chainId: chainIds[1],
      functionName: "setUriOf",
    });
    expect(mocks.writeContractAsync.mock.calls[1][0].args).toEqual(
      mocks.writeContractAsync.mock.calls[0][0].args,
    );
    expect(screen.getByText("Confirm metadata")).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    await act(async () => resolveSecond({ status: "success" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.sendRelayrTx).not.toHaveBeenCalled();
  });

  it("stops before the next chain when a Safe write is still a proposal", async () => {
    mocks.safe = true;
    mocks.connectedChainId = 1;
    mocks.requireOnchainExecution.mockImplementation(() => {
      throw new Error("This metadata update was proposed to Safe. Execute it before continuing.");
    });
    await openDialog([1, 8453].map((chainId) => ({ ...PROJECTS[0], chainId })));
    await prefilledAdvancedTextarea();
    await save();
    await screen.findByText("Confirm metadata");
    const confirm = screen.getByRole("button", { name: "Save changes" });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await screen.findByText(
      "This metadata update was proposed to Safe. Execute it before continuing.",
    );
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.waitForReceipt).not.toHaveBeenCalled();
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm metadata")).toBeInTheDocument();
  });
});

describe("metadata edits across distinct destinations", () => {
  const projects = [
    { ...PROJECTS[0], chainId: 1, projectId: 4 },
    { ...PROJECTS[0], chainId: 8453, projectId: 91 },
  ];
  const quote = {
    bundle_uuid: "metadata-bundle",
    payment_info: [{ chain: 1, amount: "0x10", target: `0x${"44".repeat(20)}`, calldata: "0x" }],
  };

  it("pins each preserved document and signs its active controller and destination project ID", async () => {
    mocks.connectedChainId = 1;
    mocks.peerMetadata[1] = CURRENT_METADATA;
    mocks.peerMetadata[8453] = {
      ...CURRENT_METADATA,
      description: "Peer description",
      logoUri: "ipfs://peer-logo",
      leagueID: "peer-league",
      peerOnly: { keep: true },
      tags: ["peer"],
    };
    mocks.controllers = { 1: `0x${"55".repeat(20)}`, 8453: `0x${"66".repeat(20)}` };
    mocks.getRelayrTxQuote.mockResolvedValue(quote);
    mocks.pinProjectMetadata
      .mockResolvedValueOnce("QmTFCRTLGXQZgPjNMLxRHfnTQpsvSNvzEpx6NKCcXgSTuA")
      .mockResolvedValueOnce("bafkreihz5xk2crdko5mllpxbfa443m2o6pmzcmbg5b3uvif6ho4x45z674");
    await openDialog(projects);
    await prefilledAdvancedTextarea();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Shared new name" } });
    await save();
    await waitFor(() => expect(mocks.getRelayrTxQuote).toHaveBeenCalledOnce());
    expect(mocks.pinProjectMetadata).toHaveBeenCalledTimes(2);
    expect(mocks.pinProjectMetadata.mock.calls[0][0]).toMatchObject({
      name: "Shared new name",
      description: "Current description",
      leagueID: "l-1",
    });
    expect(mocks.pinProjectMetadata.mock.calls[1][0]).toMatchObject({
      name: "Shared new name",
      description: "Peer description",
      logoUri: "ipfs://peer-logo",
      leagueID: "peer-league",
      peerOnly: { keep: true },
      tags: ["peer"],
    });
    const calls = mocks.getRelayrTxQuote.mock.calls[0][0];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      chainId: 1,
      recoveryScope: "project-metadata:1:4",
      data: { to: mocks.controllers[1] },
      review: {
        functionName: "setUriOf",
        args: [4n, "ipfs://QmTFCRTLGXQZgPjNMLxRHfnTQpsvSNvzEpx6NKCcXgSTuA"],
      },
      metadataSource: { controller: mocks.controllers[1], projectId: "4", uri: "ipfs://source" },
    });
    expect(calls[1]).toMatchObject({
      chainId: 8453,
      data: { to: mocks.controllers[8453] },
      review: { args: [91n, "ipfs://bafkreihz5xk2crdko5mllpxbfa443m2o6pmzcmbg5b3uvif6ho4x45z674"] },
    });
  });

  it("shares one pinned URI when resulting destination documents are identical", async () => {
    mocks.connectedChainId = 1;
    mocks.getRelayrTxQuote.mockResolvedValue(quote);
    await openDialog(projects);
    await prefilledAdvancedTextarea();
    await save();
    await waitFor(() => expect(mocks.getRelayrTxQuote).toHaveBeenCalledOnce());
    expect(mocks.pinProjectMetadata).toHaveBeenCalledOnce();
    const calls = mocks.getRelayrTxQuote.mock.calls[0][0];
    expect(calls[0].review.args[1]).toBe(calls[1].review.args[1]);
    expect(calls[1].review.args[0]).toBe(91n);
  });

  it("preserves concurrent untouched changes read immediately before pinning", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();
    mocks.refetch.mockResolvedValue({
      data: { ...CURRENT_METADATA, description: "New from another editor", newField: true },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Edited name" } });
    await save();
    expect(await pinnedMetadata()).toMatchObject({
      name: "Edited name",
      description: "New from another editor",
      newField: true,
    });
  });

  it("stops the whole edit before pinning when any destination lacks permission", async () => {
    mocks.verifyMetadataSource.mockImplementation(async (_client, source) => {
      if (source.chainId === 8453) throw new Error("No metadata permission on Base");
    });
    await openDialog(projects);
    await prefilledAdvancedTextarea();
    await save();
    await waitFor(() => expect(mocks.verifyMetadataSource).toHaveBeenCalledTimes(2));
    expect(mocks.pinProjectMetadata).not.toHaveBeenCalled();
    expect(mocks.getRelayrTxQuote).not.toHaveBeenCalled();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });

  it("does not bypass an unresolved relay by changing to a direct metadata update", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();
    await save();
    await screen.findByText("Confirm metadata");
    mocks.requireRelayrRecoveryScopeAvailable.mockImplementation(() => {
      throw new Error("Previous relay requires reconciliation");
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Previous relay requires reconciliation");
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });

  it("rejects a source pointer that changes while the direct review is open", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();
    await save();
    await screen.findByText("Confirm metadata");
    mocks.verifyMetadataSource.mockRejectedValue(
      new Error("The source metadata changed. Reopen the editor."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("The source metadata changed. Reopen the editor.");
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });
});

describe("EditMetadataDialog advanced custom properties", () => {
  it("collapses the advanced section and prefills the unmanaged keys as JSON", async () => {
    await openDialog();

    const details = screen.getByText("Advanced").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);

    const textarea = await prefilledAdvancedTextarea();
    expect(JSON.parse(textarea.value)).toEqual({ leagueID: "l-1", tags: ["defi"] });
  });

  it("shows loading and blocks saving until the metadata JSON resolves", async () => {
    let resolveMetadata: (value: { data?: unknown }) => void = () => undefined;
    mocks.refetch.mockReturnValue(
      new Promise<{ data?: unknown }>((resolve) => {
        resolveMetadata = resolve;
      }),
    );

    await openDialog();

    expect(screen.getByText(/loading current metadata/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save changes$/i })).toBeDisabled();
    expect(screen.queryByLabelText(/custom properties/i)).not.toBeInTheDocument();

    resolveMetadata({ data: CURRENT_METADATA });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^save changes$/i })).not.toBeDisabled(),
    );
  });

  it("blocks saving on invalid JSON and shows an inline error", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), { target: { value: "{ oops" } });
    await save();

    await waitFor(() => expect(screen.getByText(/invalid json/i)).toBeInTheDocument());
    expect(mocks.pinProjectMetadata).not.toHaveBeenCalled();
  });

  it("rejects JSON that is not an object", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), { target: { value: "[1,2]" } });
    await save();

    await waitFor(() =>
      expect(screen.getByText(/custom properties must be a json object/i)).toBeInTheDocument(),
    );
    expect(mocks.pinProjectMetadata).not.toHaveBeenCalled();
  });

  it("keeps custom properties when the advanced editor is untouched", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    await save();

    const pinned = await pinnedMetadata();
    expect(pinned.leagueID).toBe("l-1");
    expect(pinned.tags).toEqual(["defi"]);
    expect(pinned.name).toBe("Current name");

    // Nothing is written until the confirm dialog's action is pressed.
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    // The confirm opens at once and its action enables once the pin lands.
    const confirm = await screen.findByRole("button", { name: /^save changes$/i });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1));
    expect(mocks.writeContractAsync.mock.calls[0][0]).toMatchObject({
      functionName: "setUriOf",
      chainId: 11155111,
    });
  });

  it("edits, adds, and deletes custom properties", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), {
      target: { value: JSON.stringify({ leagueID: "l-2", newKey: { deep: true } }) },
    });
    await save();

    const pinned = await pinnedMetadata();
    expect(pinned.leagueID).toBe("l-2");
    expect(pinned.newKey).toEqual({ deep: true });
    expect("tags" in pinned).toBe(false);
  });

  it("clears every custom property when the prefill is emptied", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), { target: { value: "" } });
    await save();

    const pinned = await pinnedMetadata();
    expect("leagueID" in pinned).toBe(false);
    expect("tags" in pinned).toBe(false);
    expect(pinned.name).toBe("Current name");
  });

  it("lets the form fields win on a managed-key collision and notes it", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), {
      target: { value: JSON.stringify({ name: "Custom name", leagueID: "l-1" }) },
    });

    await waitFor(() => expect(screen.getByText(/ignored on save/i)).toBeInTheDocument());
    expect(screen.getByText(/ignored on save/i).textContent).toContain("name");

    await save();

    const pinned = await pinnedMetadata();
    expect(pinned.name).toBe("Current name");
    expect(pinned.leagueID).toBe("l-1");
  });
});
