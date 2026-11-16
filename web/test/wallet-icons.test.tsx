import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// A wallet announces its own icon, so the page cannot trust it. Only an inline image may be
// drawn: any other URL would tell its host that this page was opened.
const RABBY_ICON = "data:image/svg+xml;base64,PHN2Zy8+";
const HOSTILE: Record<string, string | undefined> = {
  Sneaky: "https://tracker.example/icon.png",
  Script: "data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=",
  Js: "javascript:alert(1)",
  Plain: undefined,
};

const mocks = vi.hoisted(() => ({
  connectors: [] as { id: string; name: string; icon?: string }[],
}));

vi.mock("wagmi", () => ({
  useConnect: () => ({ connectAsync: vi.fn() }),
  useConnectors: () => mocks.connectors,
}));
vi.mock("@getpara/react-sdk-lite", () => ({
  useAuthenticateWithEmailOrPhone: () => ({
    authenticateWithEmailOrPhoneAsync: vi.fn(),
    error: null,
  }),
  useAuthenticateWithOAuth: () => ({ authenticateWithOAuthAsync: vi.fn(), error: null }),
  useVerifyNewAccount: () => ({
    verifyNewAccountAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useResendVerificationCode: () => ({ resendVerificationCodeAsync: vi.fn() }),
}));
vi.mock("@/providers/para-config", () => ({
  getParaClient: () => ({
    onStatePhaseChange: (listener: (snapshot: unknown) => void) => {
      listener({ authPhase: "idle", corePhase: "unauthenticated", authStateInfo: {} });
      return () => {};
    },
    waitForWalletCreation: vi.fn(),
  }),
  PARA_APP: { appName: "Revnet" },
  PARA_PORTAL_THEME: { backgroundColor: "#F6FEF9" },
}));
vi.mock("@bananapus/nana-sdk-core/review/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review/react")>()),
  useMobileWallet: () => null,
}));

const { default: ParaAuthSheet } = await import("@/providers/ParaAuthSheet");
const { SignInShell } = await import("@/providers/SignInShell");

const sheets = {
  SignInShell: () => <SignInShell entry="" onEntryChange={() => {}} />,
  ParaAuthSheet: () => <ParaAuthSheet entry="" onEntryChange={() => {}} onClose={() => {}} />,
};

describe.each(Object.keys(sheets) as (keyof typeof sheets)[])("the wallet tiles of %s", (name) => {
  it("draw an inline image icon, and nothing a wallet could point at a remote host", () => {
    mocks.connectors = [
      { id: "io.rabby", name: "Rabby", icon: RABBY_ICON },
      ...Object.entries(HOSTILE).map(([label, icon]) => ({
        id: label.toLowerCase(),
        name: label,
        icon,
      })),
    ];
    const { container } = render(sheets[name]());
    const tile = (label: string) => screen.getByRole("button", { name: label });

    expect(
      [...tile("Rabby").querySelectorAll("img")].map((img) => img.getAttribute("src")),
    ).toEqual([RABBY_ICON]);
    for (const label of Object.keys(HOSTILE)) {
      expect(tile(label).querySelectorAll("img"), label).toHaveLength(0);
      expect(tile(label).querySelectorAll("svg"), label).toHaveLength(1);
    }
    expect(container.innerHTML).not.toContain("tracker.example");
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.innerHTML).not.toContain("text/html");
  });

  // An icon is drawn when it starts with one of these image types and then `;` or `,`, whatever the case. Nothing else is.
  const iconTile = (icon: string) => {
    mocks.connectors = [{ id: "probe", name: "Probe", icon }];
    render(sheets[name]());
    return screen.getByRole("button", { name: "Probe" });
  };

  it.each([
    ["a PNG", "data:image/png;base64,iVBORw0KGgo="],
    ["a WebP", "data:image/webp;base64,UklGRg=="],
    ["a JPEG", "data:image/jpeg;base64,/9j/4AAQ"],
    ["a GIF", "data:image/gif;base64,R0lGODlh"],
    ["a scheme and image type in capitals", "DATA:IMAGE/PNG;base64,iVBORw0KGgo="],
  ])("draws %s", (_label, icon) => {
    expect(
      [...iconTile(icon).querySelectorAll("img")].map((img) => img.getAttribute("src")),
    ).toEqual([icon]);
  });

  it.each([
    ["image/jpg, which the list spells jpeg", "data:image/jpg;base64,/9j/4AAQ"],
    ["an image type the list leaves out", "data:image/x-icon;base64,AAABAA=="],
    ["an SVG type with no payload after it", "data:image/svg+xml"],
  ])("draws the generic mark for %s", (_label, icon) => {
    const tile = iconTile(icon);

    expect(tile.querySelectorAll("img")).toHaveLength(0);
    expect(tile.querySelectorAll("svg")).toHaveLength(1);
  });
});
