import {
  logoutParaSession,
  ParaLocalDisconnectError,
  ParaSessionLogoutError,
} from "@/providers/para-logout";
import { describe, expect, it, vi } from "vitest";

describe("logoutParaSession", () => {
  it("confirms Para logout before clearing the marker and disconnecting Wagmi", async () => {
    const order: string[] = [];
    const logout = vi.fn(async () => {
      order.push("logout");
    });
    const markSession = vi.fn(() => {
      order.push("marker");
    });
    const disconnect = vi.fn(async () => {
      order.push("disconnect");
    });

    await logoutParaSession({
      disconnect,
      load: async () => ({ getParaClient: () => ({ logout }) }) as never,
      markSession,
    });

    expect(order).toEqual(["logout", "marker", "disconnect"]);
    expect(markSession).toHaveBeenCalledWith(false);
  });

  it("keeps the marker and Wagmi connection when authoritative logout fails", async () => {
    const markSession = vi.fn();
    const disconnect = vi.fn();

    await expect(
      logoutParaSession({
        disconnect,
        load: async () =>
          ({
            getParaClient: () => ({
              logout: vi.fn(async () => {
                throw new Error("Para unavailable");
              }),
            }),
          }) as never,
        markSession,
      }),
    ).rejects.toBeInstanceOf(ParaSessionLogoutError);

    expect(markSession).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("reports a local reset failure only after authoritative logout is complete", async () => {
    const markSession = vi.fn();

    await expect(
      logoutParaSession({
        disconnect: vi.fn(async () => {
          throw new Error("Wagmi unavailable");
        }),
        load: async () =>
          ({
            getParaClient: () => ({ logout: vi.fn(async () => undefined) }),
          }) as never,
        markSession,
      }),
    ).rejects.toBeInstanceOf(ParaLocalDisconnectError);

    expect(markSession).toHaveBeenCalledWith(false);
  });
});
