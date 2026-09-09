"use client";

/**
 * A dialog opened with `showModal()` is promoted into the browser's top layer,
 * and everything that is not a descendant of the topmost open dialog is inert
 * and painted behind its backdrop. That is true even of elements which are
 * themselves in the top layer, so `popover` is not an escape hatch: the only
 * way a body-level overlay stays usable while a dialog is open is to be
 * rendered inside that dialog.
 *
 * The registry below is the whole of the bookkeeping. It never touches a node
 * it does not own; it only answers where a floating overlay — a select
 * popover, a tooltip, the toast viewport — has to attach right now.
 */

const openDialogs: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** The node a body-level overlay must attach to right now. */
export function topLayerHost(): HTMLElement {
  return openDialogs.at(-1) ?? document.body;
}

export function subscribeToTopLayer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the dialog shell around `showModal()`; returns the release. */
export function registerOpenDialog(dialog: HTMLDialogElement): () => void {
  openDialogs.push(dialog);
  notify();
  return () => {
    const index = openDialogs.lastIndexOf(dialog);
    if (index < 0) return;
    openDialogs.splice(index, 1);
    notify();
  };
}
