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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import {
  WRITE_HOLD_PENDING_LINE,
  WRITE_HOLD_UNCHECKED_LINE,
} from "@bananapus/nana-sdk-core/review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { zeroAddress, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

// Every liquidity flow runs inside the dialog V6YouCard opens ("Market
// liquidity", "Your liquidity"), whose owner closes it on any request. While a
// send is in flight the confirm it hosts must hold that dialog: before the
// hold, Escape, a backdrop press or the × unmounted the form mid-send, and a
// reopened form could mint, edit or remove a second time.

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const PROJECT_TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const UNLOCK = `0x${"ab".repeat(40)}` as Hex;
const HASH = `0x${"cd".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  refreshPosition: vi.fn(),
  /** The flow's own Safe proposal, whose result the app can't confirm. */
  sent: undefined as `0x${string}` | undefined,
  resetRunner: () => undefined as void,
  /**
   * What the receipt watcher reports for a sent hash: still loading, a Safe
   * proposal, a receipt that never lands, or a reverted one.
   */
  receipt: { pending: false, safe: false, neverLands: false, reverted: false } as {
    pending: boolean;
    safe: boolean;
    neverLands: boolean;
    reverted: boolean;
    /** What the write hold says once a bounded watch ends: its line, and whether it has an exit. */
    held?: { line: string; exit: boolean };
  },
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
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
// A run ends as the sent hash's receipt says: still awaiting it, a Safe proposal (one whose
// result the app can't confirm when it is the flow's own), held once a bounded wait ends, or
// reverted.
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { liveReviewedAction } = await import("./support/reviewed-action");
  const runner = liveReviewedAction(mocks.write, (hash) => {
    const { receipt } = mocks;
    if (receipt.pending) return { phase: "receipt" };
    if (receipt.safe)
      return {
        phase: "proposed",
        held:
          hash === mocks.sent
            ? { line: "Check this proposal in your Safe before sending it again.", exit: true }
            : undefined,
      };
    if (receipt.neverLands)
      return { phase: "held", error: "Couldn't confirm the removal yet.", held: receipt.held! };
    if (receipt.reverted)
      return { phase: "failed", error: `Transaction ${hash} reverted onchain.` };
    return undefined;
  });
  mocks.resetRunner = runner.reset;
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
    prepareAddLiquidity: () => plan,
    prepareMarketLiquidity: () => plan,
    reverifyAddLiquidity: async () => undefined,
    reverifyMarketLiquidity: async () => undefined,
    reverifyEditLiquidity: async () => undefined,
    reverifyMarketEdit: async () => undefined,
    refreshPoolAndPosition: async (pool: PoolSnapshot) => ({ pool, position }),
    prepareEditLiquidity: () => editPlan,
    prepareMarketEdit: () => marketPlan,
    readUserLpPositions: async () => [position],
    readLpPositionFees: async () => ({ tokenFees: 5n, pairFees: 5n }),
    refreshUserLpPosition: mocks.refreshPosition,
    prepareRemoveLiquidity: () => plan,
    prepareCollectLpFees: () => plan,
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

/** V6YouCard's dialogs: the owner closes on any request. */
function Host({ title, seen, children }: { title: string; seen: boolean[]; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <Dialog
      open
      onOpenChange={(next) => {
        seen.push(next);
        if (!next) setOpen(false);
      }}
    >
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  ) : null;
}

function renderHosted(title: string, flow: ReactNode) {
  const seen: boolean[] = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Host title={title} seen={seen}>
        {flow}
      </Host>
    </QueryClientProvider>,
  );
  return seen;
}

const hostDialog = (title: string) =>
  screen.getByRole("dialog", { name: title }) as HTMLDialogElement;
const confirmPanel = async () => {
  await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).not.toBeNull());
  return document.querySelector<HTMLElement>("[data-tx-confirm]")!;
};
const hostClose = (dialog: HTMLDialogElement) =>
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => !button.closest("[data-tx-confirm]") && button.textContent === "Close",
  )!;

/** Every way out of the host while the send is in flight; none may close it. */
function tryEveryWayOut(title: string, seen: boolean[]) {
  const dialog = hostDialog(title);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.pointerDown(dialog);
  fireEvent.click(hostClose(dialog));
  expect(seen).toEqual([]);
  expect(dialog.open).toBe(true);
  expect(document.querySelector("[data-tx-confirm]")).not.toBeNull();
}

/** A wallet prompt that has not answered yet; `answer` settles it. */
function pendingWrite() {
  let answer!: (hash: Hex) => void;
  mocks.write.mockImplementation(
    () =>
      new Promise<Hex>((resolve) => {
        answer = resolve;
      }),
  );
  return (hash: Hex) => answer(hash);
}

beforeEach(() => {
  mocks.sent = undefined;
  mocks.write.mockReset();
  mocks.refreshPosition.mockReset().mockResolvedValue(position);
  mocks.receipt = { pending: false, safe: false, neverLands: false, reverted: false };
  mocks.resetRunner();
});

/** Opens the removal confirm for the one position and presses its action. */
async function removePosition() {
  const seen = renderHosted(
    "Your liquidity",
    <LiquidityManager states={[state]} tokenSymbol="ART" heading={null} />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  const confirm = await confirmPanel();
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  return { seen, confirm };
}

describe("liquidity flows hold their dialog while a send is in flight", () => {
  it("add liquidity", async () => {
    const answer = pendingWrite();
    const seen = renderHosted(
      "Market liquidity",
      <AddLiquidityForm state={state} tokenSymbol="MARKEE" />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "20000000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Make the market" }).at(-1)!);
    await confirmPanel();

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Market liquidity", seen);

    answer(HASH);
    await screen.findByText("Liquidity added.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(seen).toEqual([false]);
  });

  it("edit position", async () => {
    pendingWrite();
    const seen = renderHosted(
      "Your liquidity",
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
    await confirmPanel();

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Your liquidity", seen);
  });

  it("edit market", async () => {
    pendingWrite();
    const seen = renderHosted(
      "Your liquidity",
      <MarketEditPanel
        state={state}
        pool={pool}
        sides={{ tokenSide: position, pairSide: null }}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit the market" }));
    await confirmPanel();

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Your liquidity", seen);
  });

  it("claim fees", async () => {
    pendingWrite();
    const seen = renderHosted(
      "Your liquidity",
      <LiquidityManager states={[state]} tokenSymbol="ART" heading={null} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Claim fees" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Claim fees" }));
    await confirmPanel();

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Your liquidity", seen);
  });

  it("remove, from the confirm through the position re-read that precedes the wallet prompt", async () => {
    pendingWrite();
    const seen = renderHosted(
      "Your liquidity",
      <LiquidityManager states={[state]} tokenSymbol="ART" heading={null} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled());
    // Remove reads the position for its review, then re-reads it before it asks the wallet.
    let reread!: (value: UserLpPosition) => void;
    mocks.refreshPosition.mockResolvedValueOnce(position).mockImplementationOnce(
      () =>
        new Promise<UserLpPosition>((resolve) => {
          reread = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await confirmPanel();
    await waitFor(() => expect(mocks.refreshPosition).toHaveBeenCalledTimes(2));
    tryEveryWayOut("Your liquidity", seen);

    reread(position);
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Your liquidity", seen);
  });

  it("remove, through the receipt after the wallet sends it", async () => {
    mocks.write.mockResolvedValue(HASH);
    mocks.receipt.pending = true;
    const { seen, confirm } = await removePosition();

    await within(confirm).findByText(
      (_, element) =>
        element?.tagName === "P" && element.textContent === "Waiting for confirmation…",
    );
    // The sent removal cannot be sent again while it confirms.
    expect(within(confirm).queryByRole("button", { name: "Try again" })).toBeNull();
    tryEveryWayOut("Your liquidity", seen);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("remove, proposed to Safe, ends on Done", async () => {
    mocks.write.mockResolvedValue(HASH);
    mocks.receipt.safe = true;
    const { seen, confirm } = await removePosition();

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("The removal was proposed to Safe");
    expect(within(confirm).queryByRole("button", { name: "Remove the position" })).toBeNull();
    fireEvent.click(done);
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(seen).toEqual([]);
    // The proposal may still execute: the position cannot be sent again from here.
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(
      screen.getByText("Removal proposed to Safe. The table updates once it executes."),
    ).toBeInTheDocument();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("remove, proposed to Safe with a result the app can't confirm, ends on Done with its line", async () => {
    mocks.write.mockImplementation(async () => {
      // The write's own hash, a proposal the app can't follow to its result.
      mocks.sent = HASH;
      return HASH;
    });
    mocks.receipt.safe = true;
    const { seen, confirm } = await removePosition();

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("Check this proposal in your Safe before sending it again.");
    expect(confirm).not.toHaveTextContent("awaits approvals");
    expect(within(confirm).queryByRole("button", { name: "Remove the position" })).toBeNull();
    fireEvent.click(done);
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(seen).toEqual([]);
    // The proposal may still execute: the position cannot be sent again from here.
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(
      screen.getByText("Check this proposal in your Safe before sending it again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Removal proposed to Safe/)).toBeNull();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("remove, a receipt that never lands: the hold's line shows, and the action stays locked while it has no exit", async () => {
    mocks.write.mockResolvedValue(HASH);
    mocks.receipt.neverLands = true;
    mocks.receipt.held = { line: WRITE_HOLD_PENDING_LINE, exit: false };
    const { confirm } = await removePosition();

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent(WRITE_HOLD_PENDING_LINE);
    fireEvent.click(done);
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(screen.getByText(WRITE_HOLD_PENDING_LINE)).toBeInTheDocument();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("remove, a receipt that never lands: once its hold offers the exit, the line says so and the action opens", async () => {
    mocks.write.mockResolvedValue(HASH);
    mocks.receipt.neverLands = true;
    mocks.receipt.held = { line: WRITE_HOLD_UNCHECKED_LINE, exit: true };
    const { confirm } = await removePosition();

    await waitFor(() => expect(confirm).toHaveTextContent(WRITE_HOLD_UNCHECKED_LINE));
    expect(within(confirm).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("remove, reverted: releases the confirm with the receipt's error", async () => {
    mocks.write.mockResolvedValue(HASH);
    mocks.receipt.reverted = true;
    const { confirm } = await removePosition();

    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: "Close" })).toBeEnabled(),
    );
    expect(confirm).toHaveTextContent(`Transaction ${HASH} reverted onchain.`);
    expect(within(confirm).getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(within(confirm).queryByRole("button", { name: "Done" })).toBeNull();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
});
