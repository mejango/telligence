import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeConnector = { id: string; name: string; getProvider?: () => Promise<unknown> };
type Account = { connector?: FakeConnector };

const runtime = vi.hoisted(() => ({
  connector: undefined as FakeConnector | undefined,
  onChange: undefined as ((account: Account) => void) | undefined,
  unwatch: () => undefined,
}));

vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ connector: runtime.connector }),
  watchAccount: (_config: unknown, { onChange }: { onChange: (account: Account) => void }) => {
    runtime.onChange = onChange;
    return runtime.unwatch;
  },
}));

import {
  isSafeConnection,
  isSafeConnector,
  safeWalletPeerSettled,
  useSafeConnection,
  watchSafeWalletPeer,
} from "@/lib/safe-connector";

const CONFIG = {} as never;

/** A WalletConnect connection whose session names `url` as the peer. */
const walletConnect = (url: string): FakeConnector => ({
  id: "walletConnect",
  name: "WalletConnect",
  getProvider: async () => ({ session: { peer: { metadata: { url } } } }),
});

/** Connects `connector` and lets the watcher read its session. */
async function connect(connector: FakeConnector | undefined) {
  runtime.connector = connector;
  await act(async () => {
    runtime.onChange!({ connector });
    await safeWalletPeerSettled();
  });
}

beforeEach(() => {
  // Every test starts watching a disconnected wallet, with no peer recorded.
  runtime.connector = undefined;
  watchSafeWalletPeer(CONFIG);
});

describe("Safe connection", () => {
  it("does not take a wallet named like Safe for one", () => {
    runtime.connector = { id: "injected", name: "SafePal" };
    expect(isSafeConnection(CONFIG)).toBe(false);
    runtime.connector = { id: "app.safepal", name: "SafePal Wallet" };
    expect(isSafeConnection(CONFIG)).toBe(false);
    expect(isSafeConnector(runtime.connector)).toBe(false);
  });

  it("is the Safe app connector", () => {
    runtime.connector = { id: "safe", name: "Safe" };
    expect(isSafeConnection(CONFIG)).toBe(true);
    expect(isSafeConnector(runtime.connector)).toBe(true);
  });

  it("is Safe{Wallet} over WalletConnect, and no other peer", async () => {
    await connect(walletConnect("https://app.safe.global"));
    expect(isSafeConnection(CONFIG)).toBe(true);
    expect(isSafeConnector(runtime.connector)).toBe(true);
    await connect(walletConnect("https://www.safepal.com"));
    expect(isSafeConnection(CONFIG)).toBe(false);
    await connect(walletConnect("https://app.safe.global.example"));
    expect(isSafeConnection(CONFIG)).toBe(false);
  });

  it("checks the connection once when it starts watching, and returns the unwatch", async () => {
    runtime.connector = walletConnect("https://app.safe.global");
    let unwatch!: () => void;
    await act(async () => {
      unwatch = watchSafeWalletPeer(CONFIG);
      await safeWalletPeerSettled();
    });
    expect(isSafeConnection(CONFIG)).toBe(true);
    expect(unwatch).toBe(runtime.unwatch);
  });

  it("keeps Safe{Wallet} while it reads the session again after a chain switch", async () => {
    await connect(walletConnect("https://app.safe.global"));
    // Gas chosen during the read must still be the Safe's.
    runtime.onChange!({
      connector: { ...runtime.connector!, getProvider: () => new Promise(() => undefined) },
    });
    expect(isSafeConnection(CONFIG)).toBe(true);
  });

  it("keeps the newest answer when an earlier session read finishes later", async () => {
    let finish!: (provider: unknown) => void;
    runtime.onChange!({
      connector: {
        id: "walletConnect",
        name: "WalletConnect",
        getProvider: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    await connect(walletConnect("https://www.safepal.com"));
    finish({ session: { peer: { metadata: { url: "https://app.safe.global" } } } });
    await act(async () => {
      await vi.dynamicImportSettled();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(isSafeConnection(CONFIG)).toBe(false);
  });

  it("forgets Safe{Wallet} when a session cannot be read or another wallet connects", async () => {
    await connect(walletConnect("https://app.safe.global"));
    await connect({
      id: "walletConnect",
      name: "WalletConnect",
      getProvider: async () => {
        throw new Error("No session");
      },
    });
    expect(isSafeConnection(CONFIG)).toBe(false);
    await connect(walletConnect("https://app.safe.global"));
    await connect({ id: "injected", name: "MetaMask" });
    expect(isSafeConnection(CONFIG)).toBe(false);
  });

  it("renders again once Safe{Wallet} is recognized, and when the wallet changes", async () => {
    const { result } = renderHook(() => useSafeConnection(CONFIG));
    expect(result.current).toBe(false);
    await connect(walletConnect("https://app.safe.global"));
    expect(result.current).toBe(true);
    await connect({ id: "injected", name: "SafePal" });
    expect(result.current).toBe(false);
    await connect({ id: "safe", name: "Safe" });
    expect(result.current).toBe(true);
  });
});
