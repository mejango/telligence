import {
  AddLiquidityForm,
  LiquidityManager,
} from "@/app/[slug]/components/v6/owners/market/AmmCard";
import { EditPositionPanel } from "@/app/[slug]/components/v6/owners/market/EditPositionPanel";
import type {
  AmmChainState,
  EditLiquidityPlan,
  MarketEditPlan,
  PoolSnapshot,
  UserLpPosition,
} from "@/app/[slug]/components/v6/owners/market/lib";
import { MarketEditPanel } from "@/app/[slug]/components/v6/owners/market/MarketEditPanel";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { zeroAddress, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

// A liquidity plan names the account that reviewed it: a mint's position, a
// removal's two sides and an edit's freed funds all go to it. When the wallet
// switches accounts between review and confirm, the plan must not be sent
// from the new account. The flow drops it and says so; a fresh review binds
// the send to the account that is connected.

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const UNLOCK = `0x${"ab".repeat(40)}` as Hex;
const HASH = `0x${"cd".repeat(32)}` as Hex;
const ACCOUNT_CHANGED = "The connected account changed. Review again.";

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111",
  write: vi.fn(),
  reads: [] as string[],
  holdReview: null as null | (() => () => void),
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: mocks.address }),
  useConfig: () => ({ id: "config" }),
  usePublicClient: () => ({
    readContract: async () => 10n ** 30n,
    getBalance: async () => 10n ** 30n,
  }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/lib/safe-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-connector")>()),
  isSafeConnection: () => false,
  useSafeConnection: () => false,
}));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionThrough } = await import("./support/reviewed-action");
  const runner = reviewedActionThrough(mocks.write, { connected: () => mocks.address });
  mocks.holdReview = runner.holdReview;
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: runner.hook,
  };
});
vi.mock("@/lib/waitForReceipt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/waitForReceipt")>()),
  waitForReceiptWithRetry: async () => ({ status: "success" }),
}));
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/[slug]/components/v6/owners/market/lib")>();
  const plan = {
    unlockData: `0x${"ab".repeat(40)}`,
    value: 0n,
    erc20Sides: [],
    tokenMaximum: 0n,
    pairMaximum: 0n,
    tokenMinimum: 0n,
    pairMinimum: 0n,
    tokenSide: null,
    pairSide: null,
  };
  return {
    ...actual,
    prepareMarketLiquidity: () => plan,
    reverifyMarketLiquidity: async () => undefined,
    refreshPoolAndPosition: async (pool: PoolSnapshot) => ({ pool, position }),
    prepareEditLiquidity: () => editPlan,
    prepareMarketEdit: () => marketPlan,
    readUserLpPositions: async (_pool: PoolSnapshot, owner: string) => {
      mocks.reads.push(owner);
      return [position];
    },
    readLpPositionFees: async () => ({ tokenFees: 5n, pairFees: 5n }),
    refreshUserLpPosition: async () => position,
    prepareRemoveLiquidity: () => plan,
  };
});
vi.mock("@/app/[slug]/components/v6/owners/market/liquidityWrite", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/app/[slug]/components/v6/owners/market/liquidityWrite")
  >()),
  approvalStepsFor: async () => [],
}));

const pool = {
  chainId: 8453 as JBChainId,
  projectId: 6,
  price: 0.00001,
  poolId: `0x${"7a".repeat(32)}`,
  key: { tickSpacing: 60 },
  pair: { addr: zeroAddress, decimals: 18, symbol: "ETH", currency: 1n },
  pairIsC0: true,
  projectToken: "0x3333333333333333333333333333333333333333",
} as unknown as PoolSnapshot;

const position = {
  tokenId: 42n,
  owner: A,
  info: 1n,
  liquidity: 100n,
  tickLower: -600,
  tickUpper: 600,
  pairAmount: 1_000n,
  tokenAmount: 2_000n,
} as UserLpPosition;

const state: AmmChainState = {
  chainId: 8453 as JBChainId,
  projectId: 1n,
  hook: "0x0000000000000000000000000000000000000001",
  pool,
  composition: null,
  reference: { cashOut: 6.68961e-8, issuance: 0.0016 },
};

const editPlan = {
  kind: "increase",
  tokenId: 42n,
  unlockData: UNLOCK,
  value: 0n,
  erc20Sides: [],
  tickLower: -600,
  tickUpper: 600,
  tokenHolding: 3_000n,
  pairHolding: 1_500n,
  tokenFlow: 1_000n,
  pairFlow: 500n,
  tokenFunding: 1_010n,
  pairFunding: 505n,
  tokenMinimum: 0n,
  pairMinimum: 0n,
} as unknown as EditLiquidityPlan;

const marketPlan = {
  unlockData: UNLOCK,
  token: {
    kind: "increase",
    tokenId: 42n,
    liquidityBefore: 100n,
    holding: 3_000n,
    flow: 1_000n,
    funding: 1_010n,
    minimum: 0n,
    tickLower: -600,
    tickUpper: 600,
    liquidity: 150n,
    liquidityDelta: 50n,
    amount0Max: 0n,
    amount1Max: 0n,
  },
  pair: null,
  value: 0n,
  erc20Sides: [],
  tokenFlow: 1_000n,
  pairFlow: 0n,
  tokenFunding: 1_010n,
  pairFunding: 0n,
  tokenMinimum: 0n,
  pairMinimum: 0n,
  tokenHolding: 3_000n,
  pairHolding: 0n,
  refit: false,
} as unknown as MarketEditPlan;

/** Renders `flow` and returns the switch a wallet makes to another account. */
function renderFlow(flow: () => ReactNode) {
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}>{flow()}</QueryClientProvider>);
  return (account: Address) => {
    mocks.address = account;
    view.rerender(<QueryClientProvider client={client}>{flow()}</QueryClientProvider>);
  };
}

/** Starts the flow's one review and holds it open, as a user still reading it would. */
const startHeld = async (button: HTMLElement) => {
  const release = mocks.holdReview!();
  fireEvent.click(button);
  await screen.findByRole("dialog", { name: /^Confirm/ });
  return release;
};

beforeEach(() => {
  mocks.address = A;
  mocks.write.mockReset().mockResolvedValue(HASH);
});

describe("a plan sent only from the account that reviewed it", () => {
  it("wallet-action:liquidity-management add liquidity refuses to mint the reviewed position from another account", async () => {
    const switchTo = renderFlow(() => <AddLiquidityForm state={state} tokenSymbol="MARKEE" />);
    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "20000000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });
    const release = await startHeld(
      screen.getAllByRole("button", { name: "Make the market" }).at(-1)!,
    );

    switchTo(B);
    release();

    await screen.findByText(ACCOUNT_CHANGED);
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // A fresh review is B's, and the mint is bound to B.
    fireEvent.click(screen.getAllByRole("button", { name: "Make the market" }).at(-1)!);
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0][0]).toMatchObject({
      functionName: "modifyLiquidities",
      account: B,
    });
  });

  it("wallet-action:liquidity-management remove refuses to burn the reviewed position from another account", async () => {
    const switchTo = renderFlow(() => (
      <LiquidityManager states={[state]} tokenSymbol="ART" heading={null} />
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled());
    const release = await startHeld(screen.getByRole("button", { name: "Remove" }));

    // The list reloads for B while the removal's review for A is still open.
    switchTo(B);
    release();

    await screen.findByText(ACCOUNT_CHANGED);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("shows a viewed account's positions and leaves their actions to its own wallet", async () => {
    mocks.reads.length = 0;
    act(() => setViewAs(B));
    try {
      renderFlow(() => <LiquidityManager states={[state]} tokenSymbol="ART" heading={null} />);
      const remove = await screen.findByRole("button", { name: "Remove" });
      expect(mocks.reads).toEqual([B]);
      expect(remove).toBeDisabled();
      expect(screen.getByText(/viewing another account/)).toBeInTheDocument();
    } finally {
      act(() => clearViewAs());
    }
  });

  it("wallet-action:liquidity-management edit position refuses to send the reviewed edit from another account", async () => {
    const switchTo = renderFlow(() => (
      <EditPositionPanel
        state={state}
        pool={pool}
        position={position}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    ));
    const release = await startHeld(screen.getByRole("button", { name: "Increase the position" }));

    switchTo(B);
    release();

    await screen.findByText(ACCOUNT_CHANGED);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("wallet-action:liquidity-management edit market refuses to send the reviewed edit from another account", async () => {
    const switchTo = renderFlow(() => (
      <MarketEditPanel
        state={state}
        pool={pool}
        sides={{ tokenSide: position, pairSide: null }}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    ));
    const release = await startHeld(screen.getByRole("button", { name: "Edit the market" }));

    switchTo(B);
    release();

    await screen.findByText(ACCOUNT_CHANGED);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
