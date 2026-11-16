import { Dialog, DialogContent, DialogTitle, useHoldEnclosingModal } from "@/components/ui/dialog";
import { TxProgress } from "@/components/ui/TxProgress";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { openModalDialogs, requestCloseWithoutActivation } from "./native-dialog-shim";

// The parity audit's proof for item 1, against the real dialog.tsx,
// TxProgress.tsx and this repo's native dialog shim. A confirm hosted in a
// dialog whose owner does not look at busy (cash out, borrow, refinance, repay,
// bridge, every liquidity flow) was closed by Escape or a backdrop press
// mid-send, so a reopened form could send again. A dialog whose owner refuses
// while busy (Pay's confirm, every standalone confirm: Create, Payouts, the
// operator cards) was closed by the browser anyway: hidden, still open for
// React, over a page that cannot scroll.

const pressEscape = () => fireEvent.keyDown(document, { key: "Escape" });
const pressBackdrop = (dialog: HTMLDialogElement) => fireEvent.pointerDown(dialog);

function confirmProps(busy: boolean) {
  return {
    open: true,
    onClose: () => undefined,
    title: "Confirm",
    steps: [{ title: "Approve" }, { title: "Send" }],
    activeIndex: 1,
    busy,
  };
}

/** RedeemDialog, BorrowDialog, BridgeDialog and V6YouCard's shape: the owner closes on any request. */
function HostedInUnguardedDialog({ busy, seen }: { busy: boolean; seen: boolean[] }) {
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
        <DialogTitle>Cash out</DialogTitle>
        <p>the form</p>
        <TxProgress {...confirmProps(busy)} />
      </DialogContent>
    </Dialog>
  ) : null;
}

const hostDialog = () => screen.getByRole("dialog", { name: "Cash out" }) as HTMLDialogElement;
const confirm = () => document.querySelector<HTMLElement>("[data-tx-confirm]");
/** The host's own ×. The hosted confirm hides it, which also hides its accessible name. */
const hostClose = () =>
  [...hostDialog().querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => !button.closest("[data-tx-confirm]") && button.textContent === "Close",
  )!;

describe("a confirm hosted in a dialog whose owner does not look at busy", () => {
  it("keeps the dialog and the send on screen: Escape, a backdrop press and the × are refused", () => {
    const seen: boolean[] = [];
    render(<HostedInUnguardedDialog busy seen={seen} />);
    const dialog = hostDialog();
    expect(confirm()).not.toBeNull();
    // The progress's own way back, its ×, is closed too.
    expect(within(confirm()!).getByRole("button", { name: "Close" })).toBeDisabled();
    const close = hostClose();
    expect(close.hidden).toBe(true);
    expect(close).toBeDisabled();

    pressEscape();
    pressBackdrop(dialog);
    fireEvent.click(close);

    expect(seen).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(confirm()).not.toBeNull();
  });

  it("lets the dialog close again once the send is over", () => {
    const seen: boolean[] = [];
    const { rerender } = render(<HostedInUnguardedDialog busy seen={seen} />);
    pressEscape();
    expect(seen).toEqual([]);

    rerender(<HostedInUnguardedDialog busy={false} seen={seen} />);
    expect(hostClose()).not.toBeDisabled();
    pressEscape();

    expect(seen).toEqual([false]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("shows the dialog again when the browser closes it on an Escape the page cannot cancel", () => {
    const seen: boolean[] = [];
    render(<HostedInUnguardedDialog busy seen={seen} />);
    const dialog = hostDialog();

    requestCloseWithoutActivation();

    expect(seen).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(openModalDialogs()).toEqual([dialog]);
    expect(confirm()).not.toBeNull();
  });
});

describe("a dialog whose owner refuses to close while busy (Pay's confirm)", () => {
  function GuardedByBusy({ busy, seen }: { busy: boolean; seen: boolean[] }) {
    const [open, setOpen] = useState(true);
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          seen.push(next);
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm payment</DialogTitle>
        </DialogContent>
      </Dialog>
    );
  }

  it("stays open and visible on Escape, not hidden over a page that cannot scroll", () => {
    const seen: boolean[] = [];
    const { rerender } = render(<GuardedByBusy busy seen={seen} />);
    const dialog = screen.getByRole("dialog", { name: "Confirm payment" }) as HTMLDialogElement;

    pressBackdrop(dialog);
    pressEscape();

    // Both reached the owner, which refused, and the dialog is still the one on screen.
    expect(seen).toEqual([false, false]);
    expect(dialog.open).toBe(true);
    expect(openModalDialogs()).toEqual([dialog]);

    rerender(<GuardedByBusy busy={false} seen={seen} />);
    pressEscape();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("a standalone TxProgress (Create, Payouts, the operator cards)", () => {
  function Standalone({ busy, seen }: { busy: boolean; seen: boolean[] }) {
    const [open, setOpen] = useState(true);
    return (
      <TxProgress
        {...confirmProps(busy)}
        open={open}
        onClose={() => {
          seen.push(false);
          setOpen(false);
        }}
      />
    );
  }

  it("keeps its dialog open on Escape while busy, and closes on Escape once it is not", () => {
    const seen: boolean[] = [];
    const { rerender } = render(<Standalone busy seen={seen} />);
    const dialog = screen.getByRole("dialog", { name: "Confirm" }) as HTMLDialogElement;

    pressEscape();

    expect(seen).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(openModalDialogs()).toEqual([dialog]);

    rerender(<Standalone busy={false} seen={seen} />);
    pressEscape();
    expect(seen).toEqual([false]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("useHoldEnclosingModal", () => {
  function Holder({ held }: { held: boolean }) {
    useHoldEnclosingModal(held);
    return null;
  }

  function Host({ first, second, seen }: { first: boolean; second: boolean; seen: boolean[] }) {
    const [open, setOpen] = useState(true);
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          seen.push(next);
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogTitle>Host</DialogTitle>
          <Holder held={first} />
          <Holder held={second} />
        </DialogContent>
      </Dialog>
    );
  }

  it("refuses every close path until the last hold is released", () => {
    const seen: boolean[] = [];
    const { rerender } = render(<Host first second seen={seen} />);
    const dialog = screen.getByRole("dialog", { name: "Host" }) as HTMLDialogElement;
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toBeDisabled();

    rerender(<Host first={false} second seen={seen} />);
    pressEscape();
    pressBackdrop(dialog);
    expect(seen).toEqual([]);
    expect(dialog.open).toBe(true);

    rerender(<Host first={false} second={false} seen={seen} />);
    expect(close).not.toBeDisabled();
    fireEvent.click(close);
    expect(seen).toEqual([false]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
