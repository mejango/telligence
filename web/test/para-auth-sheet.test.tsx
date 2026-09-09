import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const para = vi.hoisted(() => ({
  verifyNewAccountAsync: vi.fn(),
  waitForWalletCreation: vi.fn(async () => ({ walletIds: {} })),
  authPhase: "awaiting_account_verification" as string,
  authStateInfo: {} as Record<string, string>,
  openedUrls: [] as string[],
}));

vi.mock("@getpara/react-sdk-lite", () => ({
  useAuthenticateWithEmailOrPhone: () => ({
    authenticateWithEmailOrPhoneAsync: vi.fn(),
    error: null,
  }),
  useAuthenticateWithOAuth: () => ({ authenticateWithOAuthAsync: vi.fn(), error: null }),
  useVerifyNewAccount: () => ({
    verifyNewAccountAsync: para.verifyNewAccountAsync,
    isPending: false,
    error: null,
  }),
  useResendVerificationCode: () => ({ resendVerificationCodeAsync: vi.fn() }),
}));

vi.mock("@/providers/para-config", () => ({
  getParaClient: () => ({
    onStatePhaseChange: (listener: (snapshot: unknown) => void) => {
      listener({
        authPhase: para.authPhase,
        corePhase: "unauthenticated",
        authStateInfo: para.authStateInfo,
      });
      return () => {};
    },
    waitForWalletCreation: para.waitForWalletCreation,
  }),
  PARA_APP: { appName: "Revnet" },
  PARA_PORTAL_THEME: { backgroundColor: "#F6FEF9" },
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ connectors: [], connectWith: vi.fn() }),
}));
vi.mock("@/hooks/useMobileWallet", () => ({ useMobileWallet: () => null }));
vi.mock("wagmi", () => ({
  useConnect: () => ({ connectAsync: vi.fn() }),
  useConnectors: () => [],
}));

const { default: ParaAuthSheet } = await import("@/providers/ParaAuthSheet");

describe("ParaAuthSheet verification", () => {
  beforeEach(() => {
    para.authStateInfo = {};
    para.authPhase = "awaiting_account_verification";
    para.openedUrls.length = 0;
  });

  it("frames Para's code page in the sheet rather than sending anyone to it", async () => {
    // A `verificationUrl` means Para owns this account's OTP: `verifyNewAccount` is not a call
    // the app may make, and it never settles — so a code field here would accept a wrong code
    // and hang on it forever.
    para.authStateInfo = { verificationUrl: "https://app.getpara.com/v2/login/otp" };
    para.authPhase = "awaiting_account_verification";
    const open = vi.spyOn(window, "open").mockImplementation((url) => {
      para.openedUrls.push(String(url));
      // A claimed window with no URL yet; navigating it is what the sheet does next.
      return {
        closed: false,
        focus: () => {},
        location: {
          replace: (next: string) => para.openedUrls.push(next),
        },
      } as unknown as Window;
    });

    render(<ParaAuthSheet entry="me@example.com" onEntryChange={() => {}} onClose={() => {}} />);

    // No field of ours: `verifyNewAccount` is not a call this account allows, so one would
    // take a code, accept a wrong one, and hang on it.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // Framed here, not opened elsewhere — the visitor never leaves the page.
    const frame = screen.getByTitle("Verification code");
    expect(frame).toHaveAttribute("src", "https://app.getpara.com/v2/login/otp");
    expect(para.openedUrls).not.toContain("https://app.getpara.com/v2/login/otp");

    open.mockRestore();
  });

  it("opens the key-creation window the verify call answers with, then waits for it", async () => {
    // The URL comes back in this promise, NOT in the state stream the popup effect watches.
    // Nothing else advances a signup, so missing it leaves the sheet at "Verifying…" forever.
    para.verifyNewAccountAsync.mockResolvedValue({
      passkeyUrl: "https://app.getpara.com/v2/signup/passkey",
    });
    const open = vi.spyOn(window, "open").mockImplementation((url) => {
      para.openedUrls.push(String(url));
      // A claimed window with no URL yet; navigating it is what the sheet does next.
      return {
        closed: false,
        focus: () => {},
        location: {
          replace: (next: string) => para.openedUrls.push(next),
        },
      } as unknown as Window;
    });

    render(<ParaAuthSheet entry="me@example.com" onEntryChange={() => {}} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "089262" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(para.openedUrls).toContain("https://app.getpara.com/v2/signup/passkey"),
    );
    await waitFor(() => expect(para.waitForWalletCreation).toHaveBeenCalled());
    open.mockRestore();
  });

  it("keeps a user-initiated passkey button when Para's first popup is blocked", async () => {
    para.authPhase = "waiting_for_session";
    para.authStateInfo = {
      passkeyUrl: "https://app.getpara.com/v2/login/passkey",
    };
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(<ParaAuthSheet entry="me@example.com" onEntryChange={() => {}} onClose={() => {}} />);

    const passkeyButton = await screen.findByRole("button", { name: "Open passkey" });
    fireEvent.click(passkeyButton);
    expect(open).toHaveBeenLastCalledWith(
      "https://app.getpara.com/v2/login/passkey",
      "ParaAuth",
      "popup,width=420,height=560",
    );
    open.mockRestore();
  });
});
