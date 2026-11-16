import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { confirmHeldWriteExit } from "@/lib/flow-choice";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
}));

const LINE = "Your earlier transaction hasn't confirmed yet. Check your wallet.";
const HELD = { line: LINE, record: { call: {} } };
const HELD_VALUE = { line: LINE, record: { call: { value: 5n } } };

describe("flow choice dialog", () => {
  it("shows the held and exit lines, and sends again only on the exit button", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const answer = confirmHeldWriteExit(HELD_VALUE);
    const dialog = await screen.findByRole("dialog", { name: "Check your wallet" });
    expect(dialog).toHaveTextContent(
      "Your earlier transaction hasn't confirmed yet. Check your wallet.",
    );
    expect(dialog).toHaveTextContent(
      "If your earlier transaction went through, sending again pays twice.",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I checked my wallet. Send again" }));
    });
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole("dialog", { name: "Check your wallet" })).toBeNull();
  });

  it("keeps the hold when the user cancels", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const answer = confirmHeldWriteExit(HELD);
    await screen.findByRole("dialog", { name: "Check your wallet" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await expect(answer).resolves.toBe(false);
  });

  it("keeps the hold without a dialog provider", async () => {
    await expect(confirmHeldWriteExit(HELD)).resolves.toBe(false);
  });
});
