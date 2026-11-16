import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import {
  useTransactionReviewScope,
  type TransactionReviewScope,
} from "@/components/TransactionReviewScope";
import { requireFundingChainSelection } from "@/lib/transaction-review";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
}));
function Scope({ scope }: { scope: TransactionReviewScope }) {
  useTransactionReviewScope(scope);
  return null;
}
const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const options = [{ chainId: 1, label: "Ethereum" }];

function tree(scope: TransactionReviewScope) {
  return (
    <TransactionReviewProvider>
      <Scope scope={scope} />
    </TransactionReviewProvider>
  );
}

describe("project-scoped global reviews", () => {
  it("waits for unchanged identity at explicit approval, retaining cancellation while checking", async () => {
    const proof = deferred();
    const scope = { identity: "@name:1:42:operator", verify: vi.fn(() => proof.promise) };
    render(tree(scope));
    const result = requireFundingChainSelection(options, 1);
    await screen.findByRole("dialog", { name: "Choose where to pay" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await act(async () => undefined);
    expect(scope.verify).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Continue to payment review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent === "Checking project identity…",
      ),
    ).toBeInTheDocument();
    await act(async () => {
      proof.resolve(true);
    });
    await expect(result).resolves.toBe(1);
  });

  it("cancels the old active and queued reviews on rebind, ignoring their late proof", async () => {
    const proof = deferred();
    const scope = { identity: "A", verify: () => proof.promise };
    const view = render(tree(scope));
    const first = requireFundingChainSelection(options, 1).catch(() => null);
    const queued = requireFundingChainSelection(options, 1).catch(() => null);
    await screen.findByRole("dialog", { name: "Choose where to pay" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    view.rerender(tree({ identity: "B", verify: async () => true }));
    await expect(first).resolves.toBeNull();
    await expect(queued).resolves.toBeNull();
    const replacement = requireFundingChainSelection(options, 1).catch(() => null);
    await screen.findByRole("dialog", { name: "Choose where to pay" });
    await act(async () => {
      proof.resolve(true);
    });
    expect(screen.getByRole("dialog", { name: "Choose where to pay" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(replacement).resolves.toBeNull();
  });

  it("never approves a failed proof or a review cancelled during verification", async () => {
    const proof = deferred();
    render(tree({ identity: "A", verify: () => proof.promise }));
    const result = requireFundingChainSelection(options, 1).catch(() => null);
    await screen.findByRole("dialog", { name: "Choose where to pay" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      proof.resolve(true);
    });
    await expect(result).resolves.toBeNull();
  });
});
