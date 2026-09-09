import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ChainPayment } from "@/lib/nana/types";
import { chooseRelayrPayment, requireTransactionReview } from "@/lib/transaction-review";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { encodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { isBlockedByModalDialog, openModalDialogs } from "./native-dialog-shim";

const relayrPayments: ChainPayment[] = [
  {
    chain: 8453,
    amount: "0x1",
    calldata: "0x12345678",
    payment_deadline: "2030-01-01T00:00:00Z",
    target: "0x2222222222222222222222222222222222222222",
    token: "0x0000000000000000000000000000000000000000",
  },
  {
    chain: 10,
    amount: "0x2",
    calldata: "0x87654321",
    payment_deadline: "2030-01-01T00:00:00Z",
    target: "0x3333333333333333333333333333333333333333",
    token: "0x0000000000000000000000000000000000000000",
  },
];

vi.mock("@/hooks/useReviewedRelayr", () => ({
  resumePendingRelayrBundles: vi.fn(),
  waitForRelayrBundle: vi.fn(),
}));

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  resumeSafeProposalTracking: vi.fn(),
}));

vi.mock("@/lib/transaction-activity", () => ({
  dismissTransactionActivity: vi.fn(),
  updateTransactionActivity: vi.fn(),
  useTransactionActivities: () => [],
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
  }),
}));

describe("TransactionReviewProvider", () => {
  it("lets the user change the preferred funding chain before continuing", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const selected = vi.fn();
    const choice = chooseRelayrPayment(relayrPayments, 8453).then(selected);

    const dialog = await screen.findByRole("dialog", { name: "Choose where to pay Relayr" });
    expect(screen.getByRole("combobox")).toHaveTextContent("ETH on Base");
    expect(selected).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: /ETH on Optimism/ });
    expect(isBlockedByModalDialog(option)).toBe(false);
    expect(dialog.contains(option)).toBe(true);
    fireEvent.click(option);
    expect(screen.getByRole("combobox")).toHaveTextContent("ETH on Optimism");
    expect(selected).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await choice;
    expect(selected).toHaveBeenCalledExactlyOnceWith(relayrPayments[1]);
  });

  it("requires a funding selection when the preferred chain is not quoted", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const choice = chooseRelayrPayment([relayrPayments[0]], 42161);

    await screen.findByRole("dialog", { name: "Choose where to pay Relayr" });
    expect(screen.getByRole("combobox")).toHaveTextContent("Select chain");
    expect(screen.getByRole("button", { name: "Continue to payment review" })).toBeDisabled();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /ETH on Base/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await expect(choice).resolves.toBe(relayrPayments[0]);
  });

  it("cancels funding selection without returning a preferred payment", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const choice = chooseRelayrPayment(relayrPayments, 8453);
    const canceled = expect(choice).rejects.toThrow("Review closed. Nothing was sent.");

    await screen.findByRole("dialog", { name: "Choose where to pay Relayr" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await canceled;
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("resets the chosen funding chain when a queued request opens", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const first = chooseRelayrPayment(relayrPayments, 8453);
    const second = chooseRelayrPayment(relayrPayments);
    const canceledSecond = expect(second).rejects.toThrow("Review closed. Nothing was sent.");

    await screen.findByRole("dialog", { name: "Choose where to pay Relayr" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await expect(first).resolves.toBe(relayrPayments[0]);

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Select chain"));
    expect(screen.getByRole("button", { name: "Continue to payment review" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await canceledSecond;
  });

  it("cancels active and queued funding selections when the provider unmounts", async () => {
    const { unmount } = render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const first = expect(chooseRelayrPayment(relayrPayments, 8453)).rejects.toThrow(
      "Review closed. Nothing was sent.",
    );
    const second = expect(chooseRelayrPayment(relayrPayments, 10)).rejects.toThrow(
      "Review closed. Nothing was sent.",
    );

    await screen.findByRole("dialog", { name: "Choose where to pay Relayr" });
    unmount();

    await Promise.all([first, second]);
  });

  it("opens above the app shell in the top layer and keeps its actions interactive", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });

    render(
      <div data-testid="app-shell">
        <TransactionReviewProvider>
          <p>Payment confirmation</p>
        </TransactionReviewProvider>
      </div>,
    );

    const shell = screen.getByTestId("app-shell");

    const review = requireTransactionReview({
      title: "Review approve",
      calls: [
        {
          chainId: 8453,
          to: "0x2222222222222222222222222222222222222222",
          data: "0x12345678",
        },
      ],
    });

    const dialog = await screen.findByRole("dialog", { name: "Review approve" });
    expect(screen.getByRole("heading", { name: "Review approve" })).toBeInTheDocument();
    expect(shell.contains(dialog)).toBe(false);
    expect(isBlockedByModalDialog(dialog)).toBe(false);
    expect(isBlockedByModalDialog(shell)).toBe(true);
    expect(dialog).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "[copy tx audit prompt]" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("checkbox"));
    const approve = screen.getByRole("button", { name: "Agree & continue" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);

    await expect(review).resolves.toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays interactive above an open pay dialog whose card keeps re-rendering", async () => {
    function PayFlow({ tick: _tick }: { tick: number }) {
      const [open, setOpen] = useState(false);
      return (
        <TransactionReviewProvider>
          <button onClick={() => setOpen(true)}>Open pay</button>
          <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
            <DialogContent>
              <DialogTitle>Pay</DialogTitle>
              <button>Pay now</button>
            </DialogContent>
          </Dialog>
        </TransactionReviewProvider>
      );
    }

    const { rerender } = render(<PayFlow tick={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });

    const review = requireTransactionReview({
      title: "Review pay",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    });
    const dialog = await screen.findByRole("dialog", { name: "Review pay" });

    // The pay card re-renders on every quote refresh while the review is open.
    for (let renderCount = 1; renderCount <= 3; renderCount += 1) {
      rerender(<PayFlow tick={renderCount} />);
    }

    expect(openModalDialogs().at(-1)).toBe(dialog);
    expect(isBlockedByModalDialog(dialog)).toBe(false);
    expect(isBlockedByModalDialog(screen.getByRole("dialog", { name: "Pay", hidden: true }))).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("checkbox"));
    const approve = screen.getByRole("button", { name: "Agree & continue" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await expect(review).resolves.toBeUndefined();
  });

  it("hands the top layer back to the pay dialog once the review is answered", async () => {
    function Shell() {
      const [open, setOpen] = useState(false);
      return (
        <TransactionReviewProvider>
          <button onClick={() => setOpen(true)}>Open pay</button>
          <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
            <DialogContent>
              <DialogTitle>Pay</DialogTitle>
              <button>Pay now</button>
            </DialogContent>
          </Dialog>
        </TransactionReviewProvider>
      );
    }

    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Open pay" }));
    const payDialog = await screen.findByRole("dialog", { name: "Pay" });

    const review = requireTransactionReview({
      title: "Review pay",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    });
    await screen.findByRole("dialog", { name: "Review pay" });
    expect(isBlockedByModalDialog(payDialog)).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree & continue" }));
    await expect(review).resolves.toBeUndefined();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review pay" })).toBeNull());
    expect(openModalDialogs()).toEqual([payDialog]);
    expect(isBlockedByModalDialog(screen.getByRole("button", { name: "Pay now" }))).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("never renders an empty guidance banner when the description is blank", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);

    void requireTransactionReview({
      title: "Review pay",
      description: "   ",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    }).catch(() => undefined);

    const dialog = await screen.findByRole("dialog", { name: "Review pay" });
    for (const paragraph of dialog.querySelectorAll("p")) {
      expect(paragraph.textContent?.trim()).not.toBe("");
    }
    expect(
      screen.getByText(/These are the exact app-controlled fields your wallet will be asked/),
    ).toBeInTheDocument();
  });

  it("shows a caller-supplied description instead of the default guidance", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);

    void requireTransactionReview({
      title: "Review pay",
      description: "This Safe proposal executes later.",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    }).catch(() => undefined);

    await screen.findByRole("dialog", { name: "Review pay" });
    expect(screen.getByText("This Safe proposal executes later.")).toBeInTheDocument();
    expect(
      screen.queryByText(/These are the exact app-controlled fields your wallet will be asked/),
    ).toBeNull();
  });

  it("labels the Permit2 approval destination, USDC token, and Uniswap spender", async () => {
    const abi = [
      {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
          { name: "token", type: "address" },
          { name: "spender", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
        ],
        outputs: [],
      },
    ] as const;
    const args = [
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "0x6fF5693b99212Da76ad316178A184AB56D299b43",
      50_000_000n,
      1_800_000_000,
    ] as const;
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);

    void requireTransactionReview({
      calls: [
        {
          chainId: 8453,
          to: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          data: encodeFunctionData({ abi, functionName: "approve", args }),
          abi,
          functionName: "approve",
          args,
        },
      ],
    }).catch(() => undefined);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Permit2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3");
    expect(dialog).toHaveTextContent("USDC |");
    expect(dialog).toHaveTextContent("Uniswap Universal Router |");
  });
});
