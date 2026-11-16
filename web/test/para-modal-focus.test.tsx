import { act, render, screen } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ release: null as null | (() => void) }));

vi.mock("@getpara/react-component-library", () => ({
  PortalContainerProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@getpara/react-sdk-lite", () => ({
  // ParaProvider renders nothing until Para's API answers.
  ParaProvider: function ParaProvider({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      provider.release = () => setReady(true);
    }, []);
    return ready ? <>{children}</> : null;
  },
}));
vi.mock("@getpara/web-sdk", () => ({
  Network: {},
  OnRampAsset: {},
  OnRampProvider: {},
  OnRampPurchaseType: {},
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: undefined }), useConnectors: () => [] }));
vi.mock("@/providers/para-config", () => ({
  getParaClient: () => ({ isFullyLoggedIn: async () => false }),
  PARA_APP: { appName: "Revnet" },
  PARA_ONRAMP_PROVIDER: "STRIPE",
  recordOnRampPurchase: vi.fn(),
}));
vi.mock("@/providers/OnRampHandoff", () => ({
  OnRampFrame: () => null,
  OnRampHandoff: () => null,
}));
vi.mock("@/providers/SignInShell", () => ({
  SignInShell: () => <input aria-label="Email address or phone number" data-sheet="shell" />,
}));
vi.mock("@/providers/ParaAuthSheet", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <>
      <button aria-label="Close" onClick={onClose} />
      <input aria-label="Email address or phone number" data-sheet="live" autoFocus />
    </>
  ),
}));

const { default: ParaModalHost } = await import("@/providers/ParaModalHost");

const closes = vi.fn();
const ORIGINAL = {
  showModal: HTMLDialogElement.prototype.showModal,
  close: HTMLDialogElement.prototype.close,
};

beforeEach(() => {
  closes.mockReset();
  // jsdom has no top layer. Match the browser: opening hands focus to the first control, and
  // closing does not know about an opener whose dialog was replaced.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>("button,input")?.focus();
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    closes();
    this.removeAttribute("open");
    (document.activeElement as HTMLElement | null)?.blur();
  };
});

afterEach(() => {
  HTMLDialogElement.prototype.showModal = ORIGINAL.showModal;
  HTMLDialogElement.prototype.close = ORIGINAL.close;
});

function open(returnFocus: { current: HTMLElement | null }) {
  return render(
    <ParaModalHost
      requestId={1}
      request={{ kind: "auth" }}
      onOpenChange={vi.fn()}
      onSettled={vi.fn()}
      entry=""
      onEntryChange={vi.fn()}
      returnFocus={returnFocus}
    />,
  );
}

async function goLive() {
  await act(async () => provider.release?.());
}

describe("sign-in dialog focus", () => {
  it("is named, and focuses the field while Para is still starting", () => {
    open({ current: null });
    const dialog = document.querySelector("dialog")!;
    expect(dialog).toHaveAttribute("aria-label", "Sign in");
    expect(document.activeElement).toHaveAttribute("data-sheet", "shell");
  });

  it("hands the field over without closing the dialog when the live sheet swaps in", async () => {
    open({ current: null });
    await goLive();

    expect(closes).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveAttribute("data-sheet", "live");
    expect(document.querySelector('[data-sheet="shell"]')).toBeNull();
  });

  it("returns focus to the control that asked for sign-in", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    open({ current: opener });
    await goLive();
    expect(opener).not.toHaveFocus();

    await act(async () => screen.getByRole("button", { name: "Close", hidden: true }).click());

    expect(closes).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
