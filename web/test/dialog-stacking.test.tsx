import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { isBlockedByModalDialog, openModalDialogs } from "./native-dialog-shim";

/**
 * `showModal()` inerts everything outside the topmost dialog, and a real
 * browser refuses to deliver a click into an inert subtree. jsdom has no top
 * layer, so the shim answers the same question and this helper enforces it.
 */
function click(element: HTMLElement) {
  if (isBlockedByModalDialog(element)) return;
  fireEvent.click(element);
}

function dialogNamed(name: string): HTMLDialogElement {
  // `hidden: true` so a dialog that the top layer has inerted is still findable.
  return screen.getByRole("dialog", { name, hidden: true }) as HTMLDialogElement;
}

/**
 * The production shape: a payment dialog whose parent re-renders continuously
 * (quote polling, amount input) while a review dialog sits on top of it. Every
 * callback is an inline arrow, so each render hands the dialog new identities.
 */
function StackedDialogs({ agree, tick: _tick = 0 }: { agree: () => void; tick?: number }) {
  const [payOpen, setPayOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setPayOpen(true)}>Open pay</button>
      <Dialog open={payOpen} onOpenChange={(next) => setPayOpen(next)}>
        <DialogContent onEscapeKeyDown={() => undefined}>
          <DialogTitle>Pay</DialogTitle>
          <button onClick={() => setReviewOpen(true)}>Open review</button>
          <button onClick={agree}>Pay now</button>
        </DialogContent>
      </Dialog>
      <Dialog open={reviewOpen} onOpenChange={(next) => setReviewOpen(next)}>
        <DialogContent onEscapeKeyDown={() => undefined}>
          <DialogTitle>Review</DialogTitle>
          <input aria-label="I reviewed the calldata" type="checkbox" />
          <button onClick={agree}>Agree and continue</button>
          <button onClick={() => setReviewOpen(false)}>Cancel</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

describe("stacked native dialogs", () => {
  it("keeps the top dialog interactive when the dialog underneath re-renders", async () => {
    const agree = vi.fn();
    const { rerender } = render(<StackedDialogs agree={agree} tick={0} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    click(screen.getByRole("button", { name: "Open review" }));
    await screen.findByRole("dialog", { name: "Review" });

    // The payment card re-renders on every quote/preview tick.
    for (let renderCount = 1; renderCount <= 3; renderCount += 1) {
      rerender(<StackedDialogs agree={agree} tick={renderCount} />);
    }

    expect(isBlockedByModalDialog(dialogNamed("Review"))).toBe(false);

    const checkbox = screen.getByRole("checkbox", { name: "I reviewed the calldata" });
    expect(isBlockedByModalDialog(checkbox)).toBe(false);
    click(checkbox);
    expect(checkbox).toBeChecked();

    click(screen.getByRole("button", { name: "Agree and continue" }));
    expect(agree).toHaveBeenCalledTimes(1);
  });

  it("nests dialogs newest on top and restores the one underneath on close", async () => {
    const agree = vi.fn();
    render(<StackedDialogs agree={agree} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    expect(isBlockedByModalDialog(dialogNamed("Pay"))).toBe(false);

    click(screen.getByRole("button", { name: "Open review" }));
    await screen.findByRole("dialog", { name: "Review" });
    expect(openModalDialogs()).toEqual([dialogNamed("Pay"), dialogNamed("Review")]);
    expect(isBlockedByModalDialog(dialogNamed("Pay"))).toBe(true);

    click(screen.getByRole("button", { name: "Pay now", hidden: true }));
    expect(agree).not.toHaveBeenCalled();

    click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review" })).toBeNull());

    expect(openModalDialogs()).toEqual([dialogNamed("Pay")]);
    expect(isBlockedByModalDialog(dialogNamed("Pay"))).toBe(false);
    click(screen.getByRole("button", { name: "Pay now" }));
    expect(agree).toHaveBeenCalledTimes(1);
  });

  it("covers the dialog underneath while a newer one is open, and uncovers it on close", async () => {
    render(<StackedDialogs agree={vi.fn()} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    expect(dialogNamed("Pay")).not.toHaveAttribute("data-covered");

    click(screen.getByRole("button", { name: "Open review" }));
    await screen.findByRole("dialog", { name: "Review" });
    expect(dialogNamed("Pay")).toHaveAttribute("data-covered");
    expect(dialogNamed("Review")).not.toHaveAttribute("data-covered");

    click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review" })).toBeNull());
    expect(dialogNamed("Pay")).not.toHaveAttribute("data-covered");
  });

  it("leaves overlays mounted after the dialog opened untouched", async () => {
    const agree = vi.fn();
    const { rerender } = render(<StackedDialogs agree={agree} tick={0} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });

    // Nothing outside the dialog is mutated, so a body-level node mounted
    // after the fact carries no leftover attributes to clean up.
    const lateOverlay = document.createElement("div");
    document.body.appendChild(lateOverlay);

    rerender(<StackedDialogs agree={agree} tick={1} />);

    expect(lateOverlay.attributes).toHaveLength(0);
    lateOverlay.remove();
  });

  it("does not steal focus back on every parent re-render", async () => {
    const agree = vi.fn();
    const { rerender } = render(<StackedDialogs agree={agree} tick={0} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    const payNow = screen.getByRole("button", { name: "Pay now" });
    // The shell initially focuses itself, then leaves the user's chosen focus alone.
    expect(dialogNamed("Pay")).toHaveFocus();

    payNow.focus();
    rerender(<StackedDialogs agree={agree} tick={1} />);
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

    expect(payNow).toHaveFocus();
  });

  it("closes only the topmost dialog on Escape and unlocks the body last", async () => {
    const agree = vi.fn();
    render(<StackedDialogs agree={agree} />);
    const shell = screen.getByRole("button", { name: "Open pay" }).parentElement!;

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    expect(isBlockedByModalDialog(shell)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    click(screen.getByRole("button", { name: "Open review" }));
    await screen.findByRole("dialog", { name: "Review" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review" })).toBeNull());

    // The pay dialog is still open: the shell stays inert and the body locked.
    expect(screen.getByRole("dialog", { name: "Pay" })).toBeInTheDocument();
    expect(isBlockedByModalDialog(shell)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pay" })).toBeNull());
    expect(isBlockedByModalDialog(shell)).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps a dialog open when a caller prevents the cancel", async () => {
    function Blocking() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
            <DialogTitle>Sending</DialogTitle>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Blocking />);
    await screen.findByRole("dialog", { name: "Sending" });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Sending" })).toBeInTheDocument();
  });

  it("dismisses on a backdrop press but not on a press inside the panel", async () => {
    function Single() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Cash out</DialogTitle>
            <button>Confirm</button>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Single />);
    const dialog = await screen.findByRole("dialog", { name: "Cash out" });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByRole("dialog", { name: "Cash out" })).toBeInTheDocument();

    fireEvent.pointerDown(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cash out" })).toBeNull());
  });
});
