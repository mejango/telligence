import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ModalCloseButton, ModalDialog } from "@/components/ui/ModalShell";
import { TxProgress } from "@/components/ui/TxProgress";
import { topLayerHost } from "@/lib/topLayer";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { isBlockedByModalDialog, openModalDialogs } from "./native-dialog-shim";

/*
 * `@/components/ui/ModalShell` is the modal API the shared transaction review
 * and confirm files import. Here it runs on this app's dialog shell, so these
 * cases pin both halves: the bare ModalDialog behaves as Juicebox Money's does,
 * and a confirm hosted in a dialog keeps that dialog open while it is busy.
 */

function dialogs(): HTMLDialogElement[] {
  return [...document.querySelectorAll("dialog")];
}

function only(): HTMLDialogElement {
  const found = dialogs();
  expect(found).toHaveLength(1);
  return found[0];
}

function pressEscape() {
  fireEvent.keyDown(document, { key: "Escape" });
}

/** The host dialog's own ×, which the hosted confirm hides while it shows. */
function hostCloseIn(dialog: HTMLDialogElement): HTMLButtonElement {
  const close = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent === "Close",
  );
  expect(close).toBeDefined();
  return close!;
}

describe("ModalDialog", () => {
  it("opens a real dialog in the top layer with implicit modal semantics", () => {
    render(
      <ModalDialog labelledBy="title" describedBy="description" onClose={vi.fn()}>
        <div>
          <h2 id="title">Review transaction</h2>
          <p id="description">Exact calldata</p>
          <ModalCloseButton aria-label="Cancel transaction review" className="-mr-2" />
        </div>
      </ModalDialog>,
    );

    const dialog = only();
    expect(dialog.open).toBe(true);
    expect(openModalDialogs()).toEqual([dialog]);
    // `showModal()` makes role and aria-modal implicit; the labels are not.
    expect(dialog.getAttribute("role")).toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Review transaction" })).toBe(dialog);
    expect(dialog).toHaveAccessibleDescription("Exact calldata");
    // The same surface, portal, focus and scroll lock as every dialog in the app.
    expect(dialog).toHaveClass("ui-dialog");
    expect(dialog.closest("[data-ui-dialog-portal]")?.children).toHaveLength(1);
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    // Floating overlays attach inside it, like inside any other open dialog.
    expect(topLayerHost()).toBe(dialog);
    const close = screen.getByRole("button", { name: "Cancel transaction review" });
    expect(close).toHaveClass("-mr-2");
    expect(close.querySelector("svg")).toHaveClass("h-6");
  });

  it("does not re-open an already open dialog on re-render", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const view = render(
      <ModalDialog labelledBy="one" onClose={vi.fn()}>
        <h2 id="one">a</h2>
      </ModalDialog>,
    );
    view.rerender(
      <ModalDialog labelledBy="one" onClose={vi.fn()}>
        <h2 id="one">b</h2>
      </ModalDialog>,
    );

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(only().open).toBe(true);
  });

  it("routes Escape to onClose without letting the dialog close itself", () => {
    const onClose = vi.fn();
    render(
      <ModalDialog labelledBy="one" onClose={onClose}>
        <h2 id="one">One</h2>
      </ModalDialog>,
    );

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
    // React owns `open`: the dialog stays up until its owner unmounts it.
    expect(only().open).toBe(true);
  });

  it("closes on a backdrop press but not on a press inside the content", () => {
    const onClose = vi.fn();
    render(
      <ModalDialog labelledBy="one" onClose={onClose}>
        <h2 id="one">One</h2>
      </ModalDialog>,
    );

    fireEvent.pointerDown(screen.getByRole("heading", { name: "One" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(only());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps aria-describedby and honours dismissible=false", () => {
    const onClose = vi.fn();
    function Host() {
      const [dismissible, setDismissible] = useState(false);
      return (
        <ModalDialog labelledBy="t" describedBy="d" dismissible={dismissible} onClose={onClose}>
          <div>
            <h2 id="t">Review</h2>
            <p id="d">Description</p>
            <button type="button" onClick={() => setDismissible(true)}>
              allow
            </button>
          </div>
        </ModalDialog>
      );
    }
    render(<Host />);
    const dialog = only();
    expect(dialog.getAttribute("aria-describedby")).toBe("d");

    pressEscape();
    fireEvent.pointerDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "allow" }));
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("covers the dialog below, and hands the page back only when the last one closes", () => {
    document.body.style.overflow = "scroll";
    function Stack({ inner }: { inner: boolean }) {
      return (
        <Dialog open>
          <DialogContent>
            <DialogTitle>Outer</DialogTitle>
          </DialogContent>
          {inner ? (
            <ModalDialog labelledBy="inner-title" onClose={vi.fn()}>
              <h2 id="inner-title">Inner</h2>
            </ModalDialog>
          ) : null}
        </Dialog>
      );
    }

    const view = render(<Stack inner={false} />);
    const outer = only();
    view.rerender(<Stack inner />);
    const inner = screen.getByRole("dialog", { name: "Inner" });
    expect(openModalDialogs()).toEqual([outer, inner]);
    expect(outer).toHaveAttribute("data-covered");
    expect(isBlockedByModalDialog(outer)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(<Stack inner={false} />);
    expect(openModalDialogs()).toEqual([outer]);
    expect(outer).not.toHaveAttribute("data-covered");
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });

  it("closes the dialog and leaves the top layer on unmount", () => {
    const view = render(
      <ModalDialog labelledBy="one" onClose={vi.fn()}>
        <h2 id="one">One</h2>
      </ModalDialog>,
    );
    const dialog = only();

    view.unmount();

    expect(dialog.open).toBe(false);
    expect(openModalDialogs()).toEqual([]);
    expect(topLayerHost()).toBe(document.body);
  });
});

describe("a confirm hosted in a dialog", () => {
  function Hosted({
    busy,
    placement,
    onOpenChange,
    onConfirmClose,
  }: {
    busy: boolean;
    /** Flows host the confirm in the dialog's content, or beside it in the dialog. */
    placement: "content" | "dialog";
    onOpenChange: (open: boolean) => void;
    onConfirmClose: () => void;
  }) {
    const confirm = (
      <TxProgress
        open
        title="Confirm"
        steps={[{ title: "Approve" }, { title: "Mint" }]}
        activeIndex={1}
        status="Adding liquidity…"
        onClose={onConfirmClose}
        busy={busy}
      />
    );
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Add liquidity</DialogTitle>
          {placement === "content" ? confirm : null}
        </DialogContent>
        {placement === "dialog" ? confirm : null}
      </Dialog>
    );
  }

  it.each(["content", "dialog"] as const)(
    "keeps the host open while it is busy, and lets it close once it is not (in the %s)",
    async (placement) => {
      const onOpenChange = vi.fn();
      const onConfirmClose = vi.fn();
      const view = render(
        <Hosted
          busy
          placement={placement}
          onOpenChange={onOpenChange}
          onConfirmClose={onConfirmClose}
        />,
      );
      // The confirm replaced the host's content in place: one dialog, the host's.
      const dialog = only();
      expect(await screen.findByText(/Adding liquidity/)).toBeInTheDocument();
      expect(dialog.querySelector("[data-tx-confirm]")).not.toBeNull();
      const hostClose = hostCloseIn(dialog);

      pressEscape();
      fireEvent.pointerDown(dialog);
      fireEvent.click(hostClose);

      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onConfirmClose).not.toHaveBeenCalled();
      expect(dialog.open).toBe(true);
      expect(hostClose).toBeDisabled();
      // The progress's own way back, its ×, is closed too.
      expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();

      view.rerender(
        <Hosted
          busy={false}
          placement={placement}
          onOpenChange={onOpenChange}
          onConfirmClose={onConfirmClose}
        />,
      );
      expect(hostClose).toBeEnabled();
      pressEscape();
      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
    },
  );

  it("lets the backdrop and the host's × close it once the confirm is idle", async () => {
    const onOpenChange = vi.fn();
    const view = render(
      <Hosted busy placement="content" onOpenChange={onOpenChange} onConfirmClose={vi.fn()} />,
    );
    const dialog = only();
    await screen.findByText(/Adding liquidity/);

    view.rerender(
      <Hosted
        busy={false}
        placement="content"
        onOpenChange={onOpenChange}
        onConfirmClose={vi.fn()}
      />,
    );
    fireEvent.pointerDown(dialog);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(hostCloseIn(dialog));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });
});
