/**
 * jsdom 29 ships `HTMLDialogElement` with nothing but `open` attribute
 * reflection: no `showModal()`, no `close()`, no `cancel`/`close` events, and
 * no top layer. The modal shell in `src/components/ui/dialog.tsx` is built on
 * all of it, so this file implements the slice of the HTML specification the
 * unit tests assert against.
 *
 * This is a TEST shim. It is installed from `test/setup.ts` and is never
 * bundled for the browser, where the real implementation is the browser's.
 * Anything a test needs to know about the top layer must be asked for through
 * `isBlockedByModalDialog` rather than read off the DOM, because a real top
 * layer leaves no attribute behind.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Newest last, exactly like the browser's top layer. */
const modalStack: HTMLDialogElement[] = [];
const focusToRestore = new WeakMap<HTMLDialogElement, Element | null>();

let installed = false;

function topmostModal(): HTMLDialogElement | undefined {
  return modalStack.at(-1);
}

function removeFromStack(dialog: HTMLDialogElement) {
  const index = modalStack.lastIndexOf(dialog);
  if (index >= 0) modalStack.splice(index, 1);
}

/**
 * The specification's "blocked by a modal dialog": while a modal dialog is
 * open, every node outside it is inert. Only the topmost dialog participates,
 * so a stacked dialog blocks the dialog it opened on top of.
 */
export function isBlockedByModalDialog(node: Node | null): boolean {
  const top = topmostModal();
  if (!top || !node) return false;
  return !top.contains(node);
}

/** Every modal dialog currently in the stand-in top layer, newest last. */
export function openModalDialogs(): readonly HTMLDialogElement[] {
  return [...modalStack];
}

function focusInitialElement(dialog: HTMLDialogElement) {
  const target = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? dialog;
  target.focus();
}

export function installNativeDialogShim(window: Window & typeof globalThis) {
  if (installed) return;
  installed = true;

  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function showModal(this: HTMLDialogElement) {
    if (this.open) {
      throw new window.DOMException(
        "Failed to execute 'showModal' on 'HTMLDialogElement': The dialog is already open.",
        "InvalidStateError",
      );
    }
    focusToRestore.set(this, this.ownerDocument.activeElement);
    this.setAttribute("open", "");
    modalStack.push(this);
    focusInitialElement(this);
  };

  prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.removeAttribute("open");
    removeFromStack(this);
    const restore = focusToRestore.get(this);
    focusToRestore.delete(this);
    if (restore instanceof window.HTMLElement && restore.isConnected) restore.focus();
    this.dispatchEvent(new window.Event("close"));
  };

  // A close request (Escape) is processed after the key event has been
  // dispatched, and only ever reaches the topmost modal dialog.
  window.document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const top = topmostModal();
    if (!top) return;
    const cancel = new window.Event("cancel", { cancelable: true });
    top.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) top.close();
  });
}

/** Between tests the document is torn down; the stand-in top layer must be too. */
export function resetNativeDialogShim() {
  modalStack.length = 0;
}
