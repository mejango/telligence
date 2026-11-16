import { GossipCard } from "@/app/[slug]/components/v6/owners/settlement/GossipCard";
import { QueuedMovementsCard } from "@/app/[slug]/components/v6/owners/settlement/QueuedMovementsCard";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { UnverifiedSuckerError } from "@bananapus/nana-sdk-core/v6";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectEveryWayOutRefused } from "./support/confirm";
import { groupGateState } from "./support/group-write-gate";

const SUCKER = "0x3333333333333333333333333333333333333333";
const PEER_SUCKER = "0x4444444444444444444444444444444444444444";
const REGISTERED_SUCKER = "0x5555555555555555555555555555555555555555";
const TOKEN = "0x000000000000000000000000000000000000EEEe";
const HASH = `0x${"cd".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  simulate: vi.fn(),
  write: vi.fn(),
  prepareExecute: vi.fn(),
  rowProjectId: 4n,
  rows: [] as unknown[],
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111", isConnected: true }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    forceChildren: _force,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    forceChildren?: boolean;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));
vi.mock("@/components/EthereumAddress", () => ({ EthereumAddress: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionState, reviewedRunMock } = await import("./support/reviewed-action");
  const run = reviewedRunMock(mocks.simulate, mocks.write);
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: () => reviewedActionState(run),
  };
});
// Base's view of Optimism is stale, and Optimism's sucker can re-push it.
vi.mock("@/app/[slug]/components/v6/owners/settlement/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/owners/settlement/lib")>()),
  fetchGossip: async () => [
    {
      chainId: 8453,
      peers: [
        {
          peerChainId: 10,
          supply: 10n ** 18n,
          balances: [],
          snapshot: 1_700_000_000,
          level: "danger",
          label: "Stale",
          syncSucker: PEER_SUCKER,
        },
      ],
    },
  ],
  findSyncValue: async () => 10n ** 15n,
  tokenSymbolOf: async () => "ETH",
}));
vi.mock("@/lib/v6/suckerProofs", () => ({
  fetchV6BridgeRows: async () => mocks.rows,
  prepareQueuedExecute: mocks.prepareExecute,
  buildV6ClaimTxFromRow: () => ({
    chainId: 10,
    address: PEER_SUCKER,
    abi: [
      { type: "function", name: "claim", inputs: [], outputs: [], stateMutability: "nonpayable" },
    ],
    functionName: "claim",
    args: [],
  }),
}));

const CHAINS = [
  { chainId: 8453 as JBChainId, projectId: 4n },
  { chainId: 10 as JBChainId, projectId: 4n },
];

function bridgeRow(status: "claimable" | "pending") {
  return {
    createdAt: 1_700_000_000,
    chainId: 8453,
    projectId: mocks.rowProjectId,
    peerChainId: 10,
    beneficiary: "0x1111111111111111111111111111111111111111",
    beneficiary32: `0x${"00".repeat(32)}`,
    projectTokenCount: 10n ** 18n,
    terminalTokenAmount: 10n ** 15n,
    status,
    index: 0,
    sourceSucker: SUCKER,
    peerSucker: PEER_SUCKER,
    metadata: "0x",
    proof: null,
    canExecute: status === "pending",
    token: TOKEN,
    remoteToken: TOKEN,
    tokenDecimals: 18,
    infra: "optimism",
  };
}

function renderWithQueries(node: ReactNode) {
  render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

/** Holds the confirm's simulation until the returned function is called. */
function holdSimulation() {
  let answer!: () => void;
  const held = new Promise<void>((resolve) => (answer = resolve));
  mocks.simulate.mockImplementation(async () => {
    await held;
    return {};
  });
  return () => act(async () => answer());
}

beforeEach(() => {
  groupGateState.reset();
  mocks.simulate.mockReset().mockResolvedValue({});
  mocks.write.mockReset().mockResolvedValue(HASH);
  mocks.rowProjectId = 4n;
  mocks.prepareExecute
    .mockReset()
    .mockResolvedValue({ sucker: REGISTERED_SUCKER, value: 10n ** 15n });
  mocks.rows = [];
});

describe.each([
  {
    name: "sync",
    title: "Confirm sync",
    open: async () => {
      renderWithQueries(<GossipCard chains={CHAINS} />);
      fireEvent.click(await screen.findByRole("button", { name: "Sync" }));
    },
  },
  {
    name: "claim",
    title: "Confirm claim",
    open: async () => {
      mocks.rows = [bridgeRow("claimable")];
      renderWithQueries(<QueuedMovementsCard chains={CHAINS} tokenSymbol="ART" />);
      fireEvent.click(await screen.findByRole("button", { name: "Claim" }));
    },
  },
  {
    name: "execute",
    title: "Confirm execution",
    open: async () => {
      mocks.rows = [bridgeRow("pending")];
      renderWithQueries(<QueuedMovementsCard chains={CHAINS} tokenSymbol="ART" />);
      fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
    },
  },
])("the $name confirm", ({ title, open }) => {
  async function confirmOpen() {
    await open();
    return screen.findByRole("dialog", { name: title });
  }

  it("wallet-action:settlement-sync wallet-action:queued-movements refuses every way out from Confirm through the simulation before the wallet prompt", async () => {
    const release = holdSimulation();
    const confirm = await confirmOpen();
    await waitFor(() => expect(mocks.simulate).toHaveBeenCalledOnce());

    expectEveryWayOutRefused(confirm);
    expect(mocks.write).not.toHaveBeenCalled();

    await release();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).toBeNull());
  });
});

describe("settlement actions over sucker-group chains", () => {
  it.each([
    {
      action: "Sync",
      render: () => renderWithQueries(<GossipCard chains={CHAINS} />),
    },
    {
      action: "Claim",
      render: () => {
        mocks.rows = [bridgeRow("claimable")];
        renderWithQueries(<QueuedMovementsCard chains={CHAINS} tokenSymbol="ART" />);
      },
    },
    {
      action: "Execute",
      render: () => {
        mocks.rows = [bridgeRow("pending")];
        renderWithQueries(<QueuedMovementsCard chains={CHAINS} tokenSymbol="ART" />);
      },
    },
  ])(
    "wallet-action:settlement-sync wallet-action:queued-movements keeps $action off for a pair the registry does not list",
    async ({ action, render }) => {
      groupGateState.unverified = ["10:4", "8453:4"];
      render();
      const buttons = await screen.findAllByRole("button", { name: action });
      for (const button of buttons) expect(button).toBeDisabled();
      expect(screen.getAllByText("A project listed here isn't linked onchain.").length).toBe(
        buttons.length,
      );
      expect(mocks.simulate).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
});

describe("a queued movement's Execute", () => {
  it("wallet-action:queued-movements sends toRemote only to the sucker the registry lists", async () => {
    mocks.rows = [bridgeRow("pending")];
    renderWithQueries(<QueuedMovementsCard chains={CHAINS} tokenSymbol="ART" />);
    fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    expect(mocks.prepareExecute).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSucker: SUCKER, projectId: 4n }),
      "0x1111111111111111111111111111111111111111",
    );
    expect(mocks.simulate.mock.calls[0]![0]).toMatchObject({ to: REGISTERED_SUCKER });
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({
      to: REGISTERED_SUCKER,
      functionName: "toRemote",
      value: 10n ** 15n,
    });
  });

  it("wallet-action:queued-movements opens no review and sends nothing when the registry does not list the sucker", async () => {
    mocks.prepareExecute.mockRejectedValueOnce(new UnverifiedSuckerError("unregistered"));
    mocks.rows = [bridgeRow("pending")];
    renderWithQueries(<QueuedMovementsCard chains={CHAINS} tokenSymbol="ART" />);
    fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
    await waitFor(() => expect(mocks.prepareExecute).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "Confirm execution" })).toBeNull();
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("wallet-action:queued-movements checks the movement's own project when two share its chain", async () => {
    mocks.rowProjectId = 3n;
    mocks.rows = [bridgeRow("pending")];
    renderWithQueries(
      <QueuedMovementsCard
        chains={[...CHAINS, { chainId: 8453 as JBChainId, projectId: 3n }]}
        tokenSymbol="ART"
      />,
    );
    fireEvent.click((await screen.findAllByRole("button", { name: "Execute" }))[0]!);
    await waitFor(() => expect(mocks.prepareExecute).toHaveBeenCalled());
    expect(mocks.prepareExecute.mock.calls[0]![0]).toMatchObject({ projectId: 3n });
  });
});
