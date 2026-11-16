import { EditPositionPanel } from "@/app/[slug]/components/v6/owners/market/EditPositionPanel";
import type {
  AmmChainState,
  EditLiquidityPlan,
  MarketEditPlan,
  PoolSnapshot,
  UserLpPosition,
} from "@/app/[slug]/components/v6/owners/market/lib";
import {
  PERMIT2_ADDRESS,
  POSITION_MANAGER_BY_CHAIN,
} from "@/app/[slug]/components/v6/owners/market/lib";
import { liquidityBatchCalls } from "@/app/[slug]/components/v6/owners/market/liquidityWrite";
import { MarketEditPanel } from "@/app/[slug]/components/v6/owners/market/MarketEditPanel";
import { erc20ApproveAbi } from "@/lib/erc20-approve";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import type { ReviewedCall } from "@bananapus/nana-sdk-core/review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmIsOpen, expectEveryWayOutRefused, findConfirm } from "./support/confirm";
import { groupGateState } from "./support/group-write-gate";

vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

// Under a Safe app, an LP edit with pending approvals goes out as ONE batch
// (approve → Permit2 → modifyLiquidities), in that order, through core's reviewed
// batch run, never as separate proposals.

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const PROJECT_TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const UNLOCK = `0x${"ab".repeat(40)}` as Hex;

const mocks = vi.hoisted(() => ({
  marketPlan: undefined as unknown,
  writeContractAsync: vi.fn(),
  reverifyEditLiquidity: vi.fn(),
  reverifyMarketEdit: vi.fn(),
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: ACCOUNT }),
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
    children: React.ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/lib/safe-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-connector")>()),
  isSafeConnection: () => true,
  useSafeConnection: () => true,
}));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionThrough } = await import("./support/reviewed-action");
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: reviewedActionThrough(mocks.writeContractAsync, { safeBatch: true }).hook,
  };
});
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/[slug]/components/v6/owners/market/lib")>();
  return {
    ...actual,
    refreshPoolAndPosition: async (pool: PoolSnapshot, tokenId: bigint) => ({
      pool,
      position: { ...position, tokenId },
    }),
    prepareEditLiquidity: () => editPlan,
    prepareMarketEdit: () => mocks.marketPlan ?? marketPlan,
    reverifyEditLiquidity: mocks.reverifyEditLiquidity,
    reverifyMarketEdit: mocks.reverifyMarketEdit,
  };
});
// Two live approvals still owed, so the reviewed list is approve → Permit2 → edit.
vi.mock("@/app/[slug]/components/v6/owners/market/liquidityWrite", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/app/[slug]/components/v6/owners/market/liquidityWrite")
    >();
  return {
    ...actual,
    approvalStepsFor: async () => [
      {
        title: "Approve USDC access",
        detail: "Permit2 is what moves your USDC into the pool.",
        approval: { kind: "erc20", currency: USDC, max: 5_000n },
      },
      {
        title: "Authorize the Uniswap position manager for USDC",
        detail: "A capped, expiring USDC allowance.",
        approval: { kind: "permit2", currency: USDC, max: 5_000n },
      },
    ],
  };
});

const pool = {
  chainId: 8453 as JBChainId,
  projectId: 6,
  price: 0.5,
  poolId: `0x${"7a".repeat(32)}`,
  pair: { addr: USDC, decimals: 6, symbol: "USDC", currency: 1n },
  pairIsC0: false,
  projectToken: PROJECT_TOKEN,
} as unknown as PoolSnapshot;

const position = {
  tokenId: 42n,
  owner: ACCOUNT,
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
  reference: { cashOut: 0.1, issuance: 1 },
};

const editPlan = {
  kind: "increase",
  tokenId: 42n,
  unlockData: UNLOCK,
  value: 0n,
  erc20Sides: [{ currency: USDC, max: 5_000n }],
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
  erc20Sides: [{ currency: USDC, max: 5_000n }],
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

const render = (ui: React.ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

/** The one batch every converted flow must run, in this order. */
function expectOneOrderedBatch(title: string) {
  expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
  const [{ batch: calls }, action] = mocks.writeContractAsync.mock.calls[0]!;
  expect(action).toMatchObject({ batch: true, title });
  expect(calls.map((call: ReviewedCall) => call.chainId)).toEqual([8453, 8453, 8453]);
  expect(calls.map((call: ReviewedCall) => call.functionName)).toEqual([
    "approve",
    "approve",
    "modifyLiquidities",
  ]);
  // No declared return, so a token whose approve returns nothing (USDT) still simulates.
  expect(calls[0]).toMatchObject({
    to: USDC,
    abi: erc20ApproveAbi,
    args: [PERMIT2_ADDRESS, 5_000n],
  });
  expect(calls[1]).toMatchObject({ to: PERMIT2_ADDRESS, functionName: "approve" });
  expect(calls[1].args.slice(0, 3)).toEqual([USDC, POSITION_MANAGER_BY_CHAIN[8453], 5_000n]);
  expect(calls[2]).toMatchObject({ to: POSITION_MANAGER_BY_CHAIN[8453], value: 0n });
  expect(calls[2].args[0]).toBe(UNLOCK);
}

describe("LP edits under a Safe app go out as one batch", () => {
  beforeEach(() => {
    groupGateState.reset();
    mocks.marketPlan = undefined;
    mocks.writeContractAsync.mockReset().mockResolvedValue(`0x${"cd".repeat(32)}`);
    mocks.reverifyEditLiquidity.mockReset().mockResolvedValue(undefined);
    mocks.reverifyMarketEdit.mockReset().mockResolvedValue(undefined);
  });

  it("wallet-action:liquidity-management adds no funds to a pool whose project is not linked onchain", async () => {
    groupGateState.unverified = ["8453:1"];
    render(
      <EditPositionPanel
        state={state}
        pool={pool}
        position={position}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase the position" }));
    expect(await screen.findByText("A project listed here isn't linked onchain.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });

  it("still lets the wallet withdraw its own market from that pool", async () => {
    groupGateState.unverified = ["8453:1"];
    mocks.marketPlan = { ...marketPlan, tokenFunding: 0n, pairFunding: 0n };
    render(
      <MarketEditPanel
        state={state}
        pool={pool}
        sides={{ tokenSide: position, pairSide: null }}
        tokenSymbol="ART"
        startEmpty
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /market/i }).at(-1)!);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("A project listed here isn't linked onchain.")).toBeNull();
  });

  it("wallet-action:liquidity-management EditPositionPanel proposes approve → Permit2 → modifyLiquidities once, after re-verifying", async () => {
    const onDone = vi.fn();
    render(
      <EditPositionPanel
        state={state}
        pool={pool}
        position={position}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase the position" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm position edit" });
    await waitFor(() =>
      expect(dialog.textContent).toContain("Goes to your Safe as one batch of 3 calls"),
    );
    expect(dialog.textContent).toContain("Approve USDC access");

    fireEvent.click(screen.getAllByRole("button", { name: "Increase the position" }).at(-1)!);
    await waitFor(() => expect(mocks.writeContractAsync).toHaveBeenCalled());
    expectOneOrderedBatch("Review position edit");
    expect(mocks.reverifyEditLiquidity).toHaveBeenCalledWith(pool, editPlan, ACCOUNT);
    expect(mocks.reverifyEditLiquidity.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.writeContractAsync.mock.invocationCallOrder[0]!,
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
  });

  it("wallet-action:liquidity-management MarketEditPanel proposes the same ordered batch once", async () => {
    const onDone = vi.fn();
    render(
      <MarketEditPanel
        state={state}
        pool={pool}
        sides={{ tokenSide: position, pairSide: null }}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit the market" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm market edit" });
    await waitFor(() =>
      expect(dialog.textContent).toContain("Goes to your Safe as one batch of 3 calls"),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit the market" }).at(-1)!);
    await waitFor(() => expect(mocks.writeContractAsync).toHaveBeenCalled());
    expectOneOrderedBatch("Review market edit");
    expect(mocks.reverifyMarketEdit).toHaveBeenCalledWith(pool, marketPlan, ACCOUNT);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
  });

  it("refuses every way out while the batch is proposed, then hands back once it is", async () => {
    let finish!: (hash: Hex) => void;
    mocks.writeContractAsync.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onDone = vi.fn();
    render(
      <EditPositionPanel
        state={state}
        pool={pool}
        position={position}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase the position" }));
    const confirm = await findConfirm();
    await waitFor(() => expect(mocks.writeContractAsync).toHaveBeenCalledOnce());

    expectEveryWayOutRefused(confirm);

    finish(`0x${"cd".repeat(32)}`);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    await waitFor(() => expect(confirmIsOpen()).toBe(false));
    expect(mocks.writeContractAsync).toHaveBeenCalledOnce();
  });

  it("builds the batch list the three LP flows share, with only the final write dependent", () => {
    const calls = liquidityBatchCalls({
      chainId: 8453 as JBChainId,
      steps: [
        { title: "a", detail: "", approval: { kind: "erc20", currency: USDC, max: 1n } },
        { title: "b", detail: "", approval: { kind: "permit2", currency: USDC, max: 1n } },
        { title: "c", detail: "" },
      ],
      unlockData: UNLOCK,
      value: 7n,
    });
    expect(calls.map((call) => call.dependsOnPrior ?? false)).toEqual([false, false, true]);
    expect(calls.map((call) => call.functionName)).toEqual([
      "approve",
      "approve",
      "modifyLiquidities",
    ]);
    expect(calls[2]).toMatchObject({ functionName: "modifyLiquidities", value: 7n });
    expect(() =>
      liquidityBatchCalls({ chainId: 999 as JBChainId, steps: [], unlockData: UNLOCK, value: 0n }),
    ).toThrow(/unavailable on this chain/);
  });
});
