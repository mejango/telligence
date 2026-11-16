import { connectParaSession, signOutGeneration, signOutOnce } from "@/providers/para-bridge";
import { describe, expect, it, vi } from "vitest";

describe("connectParaSession", () => {
  it("connects the Para connector through Wagmi after authentication", async () => {
    const para = { id: "para", uid: "para-connector" };
    const connect = vi.fn(async () => {});
    const markSession = vi.fn();

    await expect(
      connectParaSession({
        connectors: [{ id: "injected", uid: "browser-wallet" }, para],
        connect,
        load: async () =>
          ({
            getParaClient: () => ({ isFullyLoggedIn: vi.fn(async () => true) }),
          }) as never,
        markSession,
      }),
    ).resolves.toBe(true);

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(para);
    expect(markSession).toHaveBeenCalledWith(true);
  });

  it("leaves Wagmi untouched when authentication was cancelled", async () => {
    const connect = vi.fn();
    const markSession = vi.fn();

    await expect(
      connectParaSession({
        connectors: [{ id: "para" }],
        connect,
        load: async () =>
          ({
            getParaClient: () => ({ isFullyLoggedIn: vi.fn(async () => false) }),
          }) as never,
        markSession,
      }),
    ).resolves.toBe(false);

    expect(connect).not.toHaveBeenCalled();
    expect(markSession).not.toHaveBeenCalled();
  });

  it("drops a session check that a sign-out overtook, so it cannot connect again", async () => {
    let answer!: (loggedIn: boolean) => void;
    const connect = vi.fn(async () => {});
    const markSession = vi.fn();
    const checking = connectParaSession({
      connectors: [{ id: "para" }],
      connect,
      load: async () =>
        ({
          getParaClient: () => ({
            isFullyLoggedIn: () => new Promise<boolean>((resolve) => (answer = resolve)),
          }),
        }) as never,
      markSession,
    });
    await vi.waitFor(() => expect(answer).toBeDefined());

    let finish!: () => void;
    const signingOut = signOutOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    // A second sign-out joins the one under way.
    expect(signOutOnce(async () => undefined)).toBe(signingOut);
    expect(signOutGeneration()).toBe(-1);
    answer(true);
    await expect(checking).resolves.toBe(false);
    finish();
    await signingOut;

    expect(connect).not.toHaveBeenCalled();
    expect(markSession).not.toHaveBeenCalled();
    expect(signOutGeneration()).toBeGreaterThan(0);
  });
});
