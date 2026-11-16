import { SplitHookCard } from "@/app/[slug]/components/v6/owners/market/SplitHookCard";
import type { SplitHookChainState } from "@/app/[slug]/components/v6/owners/market/lib";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectEveryWayOutRefused } from "./support/confirm";
import { groupGateState } from "./support/group-write-gate";

vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const HOOK = "0x2222222222222222222222222222222222222222" as Address;
const NATIVE = "0x000000000000000000000000000000000000EEEe" as Address;
const HASH = `0x${"cd".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  simulate: vi.fn(),
  write: vi.fn(),
  states: [] as unknown[],
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111", isConnected: true }),
  usePublicClient: () => ({ simulateContract: mocks.simulate }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    forceChildren: _force,
    connectWalletText: _connect,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    forceChildren?: boolean;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionState, reviewedRunMock } = await import("./support/reviewed-action");
  const run = reviewedRunMock(mocks.simulate, mocks.write);
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: () => reviewedActionState(run),
  };
});
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/owners/market/lib")>()),
  fetchSplitHookStates: async () => mocks.states,
}));

const STATE: SplitHookChainState = {
  chainId: 8453 as JBChainId,
  projectId: 4n,
  hook: HOOK,
  terminalToken: NATIVE,
  pairSymbol: "ETH",
  pairDecimals: 18,
  accumulated: 0n,
  hasPool: true,
  claimableFees: 5n * 10n ** 15n,
  tokenId: 7n,
  tickLower: null,
  tickUpper: null,
  deployGated: false,
};

function renderCard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SplitHookCard chains={[{ chainId: 8453 as JBChainId, projectId: 4n }]} tokenSymbol="ART" />
    </QueryClientProvider>,
  );
}

/** Opens the fee collection's confirm. */
async function openConfirm() {
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Collect fees" }));
  return screen.findByRole("dialog", { name: "Confirm fee collection" });
}

beforeEach(() => {
  groupGateState.reset();
  mocks.states = [STATE];
  mocks.simulate.mockImplementation(async (call: Record<string, unknown>) => ({ request: call }));
  mocks.write.mockResolvedValue(HASH);
});

describe("SplitHookCard", () => {
  it("wallet-action:split-hook keeps the action off for a project the registry does not list", async () => {
    groupGateState.unverified = ["8453:4"];
    renderCard();
    expect(await screen.findByRole("button", { name: "Collect fees" })).toBeDisabled();
    expect(screen.getByText("A project listed here isn't linked onchain.")).toBeInTheDocument();
    expect(mocks.simulate).not.toHaveBeenCalled();
  });

  it("wallet-action:split-hook sends the simulated fee collection on the hook's chain", async () => {
    await openConfirm();

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0][0]).toMatchObject({
      chainId: 8453,
      to: HOOK,
      functionName: "collectAndRouteLPFees",
      args: [4n, NATIVE],
    });
    expect(mocks.write.mock.calls[0][1]).toMatchObject({ account: ACCOUNT });
  });

  it("refuses every way out from Confirm through the simulation before the wallet prompt", async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    mocks.simulate.mockImplementation(async (call: Record<string, unknown>) => {
      await held;
      return { request: call };
    });
    const confirm = await openConfirm();
    await waitFor(() => expect(mocks.simulate).toHaveBeenCalledOnce());

    expectEveryWayOutRefused(confirm);
    expect(mocks.write).not.toHaveBeenCalled();

    await act(async () => answer());
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm fee collection" })).toBeNull(),
    );
  });
});
