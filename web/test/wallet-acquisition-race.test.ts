import { reviewedSendDeps } from "@/lib/reviewed-send-deps";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import type { WalletAdapter } from "@bananapus/nana-sdk-core/review";
import {
  signReviewed,
  submitReviewedContractWrite,
  WalletNotInvokedError,
} from "@bananapus/nana-sdk-core/review";
import { mainnet } from "viem/chains";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Config } from "wagmi";

import { answerReviews, loadCoreReview, stopAnswering } from "./support/core-review";

const safe = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/safe-connector", () => ({
  isSafeConnection: () => safe.value,
  safeWalletPeerSettled: async () => undefined,
}));
/** The shop-voting policy's import, held while `wait` is pending. */
const policyLoad = vi.hoisted(() => ({
  wait: null as Promise<void> | null,
  /** Runs as the policy is read from its loaded module. */
  onRead: undefined as (() => void) | undefined,
}));
vi.mock("@/lib/shop-voting-policy", async (original) => {
  await policyLoad.wait;
  const loaded = await original<typeof import("@/lib/shop-voting-policy")>();
  return {
    ...loaded,
    get requirePriceBasedShopVoting() {
      policyLoad.onRead?.();
      return loaded.requirePriceBasedShopVoting;
    },
  };
});
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"12".repeat(32)}` as const;
const tx = { chainId: 1, to: OTHER, data: "0x" as const, value: 0n, gas: 21000n } as const;
const typed = {
  domain: { chainId: 1 },
  types: { Test: [{ name: "value", type: "uint256" }] },
  primaryType: "Test",
  message: { value: 1n },
} as const;

function harness(stage: "chain" | "provider") {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const calls: string[] = [];
  let held = false;
  let failure = false;
  let walletError: unknown;
  let chainRead: (() => void) | undefined;
  const connector = (uid: string, blocked = false) => ({
    id: uid,
    uid,
    getAccounts: async () => connections.get(uid)!.accounts,
    getChainId: async () => {
      if (blocked && stage === "chain" && !held) {
        held = true;
        entered();
        await gate;
      }
      if (failure) throw new Error("Wallet provider acquisition failed.");
      return 1;
    },
    getProvider: async () => {
      if (blocked && stage === "provider" && !held) {
        held = true;
        entered();
        await gate;
      }
      return {
        request: async ({ method }: { method: string }) => {
          if (method === "eth_chainId") {
            chainRead?.();
            return "0x1";
          }
          calls.push(`${uid}:${method}`);
          if (walletError) throw walletError;
          if (method === "wallet_sendCalls") return { id: HASH };
          if (method === "eth_sendTransaction") return HASH;
          if (method === "personal_sign" || method === "eth_signTypedData_v4")
            return `0x${"12".repeat(65)}`;
          throw new Error(method);
        },
      };
    },
  });
  const connections = new Map<
    string,
    { accounts: string[]; chainId: number; connector: unknown }
  >();
  const old = connector("old", true);
  const current = connector("current");
  const config = {
    chains: [mainnet],
    state: {
      current: "old",
      status: "connected",
      connections: connections
        .set("old", { accounts: [ACCOUNT], chainId: 1, connector: old })
        .set("current", { accounts: [ACCOUNT], chainId: 1, connector: current }),
    },
  };
  return {
    config,
    calls,
    waiting,
    release,
    fail: () => {
      failure = true;
    },
    walletFails: (error: unknown) => {
      walletError = error;
    },
    onChainRead: (read: () => void) => {
      chainRead = read;
    },
    adapter: reviewedSendDeps(config as unknown as Config).adapter,
  };
}
const operations = {
  sendTransaction: (adapter: WalletAdapter) => adapter.sendTransaction(tx),
  signTypedData: (adapter: WalletAdapter) => adapter.signTypedData(typed),
  signMessage: (adapter: WalletAdapter) => adapter.signMessage("Review this message"),
  sendCalls: (adapter: WalletAdapter) =>
    adapter.sendCalls!(1, [{ to: OTHER, data: "0x", value: 0n }]),
};
beforeEach(async () => {
  await loadCoreReview();
  stopAnswering();
  clearViewAs();
  safe.value = false;
});

afterEach(stopAnswering);

// First in the file: its held policy import is the module's first.
it("invokes nothing for a send, typed signature or batch when the account changes while the shop-voting policy loads", async () => {
  let open!: () => void;
  policyLoad.wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  try {
    const h = harness("provider");
    h.release();
    const adapter = h.adapter;
    const rejected = (["sendTransaction", "signTypedData", "sendCalls"] as const).map((name) =>
      expect(operations[name](adapter)).rejects.toBeInstanceOf(WalletNotInvokedError),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.config.state.connections.get("old")!.accounts = [OTHER];
    open();
    await Promise.all(rejected);
    expect(h.calls).toEqual([]);
  } finally {
    policyLoad.wait = null;
  }
});

it.each(
  (["sendTransaction", "signTypedData", "sendCalls"] as const).flatMap((name) =>
    [1, 2, 3, 4, 5, 6].map((turns) => [name, turns] as const),
  ),
)(
  "invokes nothing for %s when the account changes %i turns after the shop-voting policy is read",
  async (name, turns) => {
    const h = harness("provider");
    h.release();
    policyLoad.onRead = () => {
      let later = Promise.resolve();
      for (let turn = 1; turn < turns; turn += 1) later = later.then(() => undefined);
      void later.then(() => {
        h.config.state.connections.get("old")!.accounts = [OTHER];
      });
    };
    try {
      await expect(operations[name](h.adapter)).rejects.toBeInstanceOf(WalletNotInvokedError);
      expect(h.calls).toEqual([]);
    } finally {
      policyLoad.onRead = undefined;
    }
  },
);

for (const stage of ["chain", "provider"] as const) {
  it.each(Object.entries(operations))(
    `invokes the replacement wallet for %s after held ${stage} acquisition`,
    async (_name, invoke) => {
      const h = harness(stage);
      const pending = invoke(h.adapter);
      await h.waiting;
      h.config.state.current = "current";
      h.release();
      await pending;
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0]).toMatch(/^current:/);
    },
  );
  it.each(["account", "chain", "route"] as const)(
    `invokes nothing after %s changes during ${stage} acquisition`,
    async (changed) => {
      const h = harness(stage);
      const pending = h.adapter.sendTransaction(tx);
      const rejected = expect(pending).rejects.toBeInstanceOf(WalletNotInvokedError);
      await h.waiting;
      if (changed === "account") h.config.state.connections.get("old")!.accounts = [OTHER];
      else if (changed === "chain") h.config.state.connections.get("old")!.chainId = 10;
      else safe.value = true;
      h.release();
      await rejected;
      expect(h.calls).toEqual([]);
    },
  );
}

it("releases the actual SDK reservation when acquisition fails before invocation, retaining the real error line", async () => {
  const h = harness("chain");
  h.fail();
  const release = vi.fn();
  const uncertain = vi.fn();
  const pending = submitReviewedContractWrite({
    request: tx,
    expectedAccount: ACCOUNT,
    currentAccount: () => ACCOUNT,
    review: async () => {},
    switchChain: async () => {},
    simulate: async (request) => request,
    beforeWrite: async () => {},
    onWriteRejected: release,
    onWriteUncertain: uncertain,
    write: () => h.adapter.sendTransaction(tx),
  });
  const rejected = expect(pending).rejects.toThrow(
    "Your wallet could not be reached. Nothing was sent; try again.",
  );
  await h.waiting;
  h.release();
  await rejected;
  expect(release).toHaveBeenCalledOnce();
  expect(uncertain).not.toHaveBeenCalled();
  expect(h.calls).toEqual([]);
});

it("preserves actual SDK signature refusal text instead of classifying it as user cancellation", async () => {
  const h = harness("provider");
  answerReviews(async () => true);
  const pending = signReviewed(
    [{ kind: "message", chainId: 1, message: "Review this message" }],
    { account: ACCOUNT },
    { adapter: h.adapter },
  );
  const rejected = expect(pending).rejects.toSatisfy(
    (error) =>
      error instanceof WalletNotInvokedError &&
      error.message === "The connected account changed. Review again.",
  );
  await h.waiting;
  h.config.state.connections.get("old")!.accounts = [OTHER];
  h.release();
  await rejected;
  expect(h.calls).toEqual([]);
});

it("keeps an actual wallet RPC failure ambiguous after invocation", async () => {
  const h = harness("provider");
  h.walletFails(new Error("Wallet RPC timed out."));
  const release = vi.fn();
  const uncertain = vi.fn();
  const pending = submitReviewedContractWrite({
    request: tx,
    expectedAccount: ACCOUNT,
    currentAccount: () => ACCOUNT,
    review: async () => {},
    switchChain: async () => {},
    simulate: async (request) => request,
    beforeWrite: async () => {},
    onWriteRejected: release,
    onWriteUncertain: uncertain,
    write: () => h.adapter.sendTransaction(tx),
  });
  const rejected = expect(pending).rejects.toThrow(/Wallet RPC timed out/);
  await h.waiting;
  h.release();
  await rejected;
  expect(release).not.toHaveBeenCalled();
  expect(uncertain).toHaveBeenCalledOnce();
  expect(h.calls).toHaveLength(1);
});

it("captures the current operation's final assertion across acquisition without coupling another action", async () => {
  const h = harness("provider");
  let invalid = false;
  const own = vi.fn(() => {
    if (invalid) throw new Error("Reviewed schedule expired.");
  });
  const unrelated = vi.fn(() => {
    throw new Error("Another action changed.");
  });
  let selected = own;
  const adapter = reviewedSendDeps(
    h.config as unknown as Config,
    () => [],
    () => selected,
  ).adapter;
  const pending = adapter.sendTransaction(tx);
  const rejected = expect(pending).rejects.toThrow("Reviewed schedule expired.");
  await h.waiting;
  selected = unrelated;
  invalid = true;
  h.release();
  await rejected;
  expect(own).toHaveBeenCalled();
  expect(unrelated).not.toHaveBeenCalled();
  expect(h.calls).toEqual([]);
});

// viem awaits its own chain read after the client loads and before it sends: a change there is
// caught as the request reaches the provider.
it.each(["connector", "account", "route", "view-as"] as const)(
  "invokes nothing when the %s changes during viem's chain read before the send",
  async (changed) => {
    const h = harness("chain");
    h.config.state.current = "current";
    h.onChainRead(() => {
      if (changed === "connector") h.config.state.current = "old";
      else if (changed === "account") h.config.state.connections.get("current")!.accounts = [OTHER];
      else if (changed === "route") safe.value = true;
      else setViewAs(OTHER);
    });
    await expect(h.adapter.sendTransaction(tx)).rejects.toBeInstanceOf(WalletNotInvokedError);
    expect(h.calls).toEqual([]);
  },
);

it("sends once, never retrying a wallet error that may have broadcast", async () => {
  const h = harness("chain");
  h.config.state.current = "current";
  h.walletFails({ code: -32603, message: "Internal error" });
  const release = vi.fn();
  const uncertain = vi.fn();
  await expect(
    submitReviewedContractWrite({
      request: tx,
      expectedAccount: ACCOUNT,
      currentAccount: () => ACCOUNT,
      review: async () => {},
      switchChain: async () => {},
      simulate: async (request) => request,
      beforeWrite: async () => {},
      onWriteRejected: release,
      onWriteUncertain: uncertain,
      write: () => h.adapter.sendTransaction(tx),
    }),
  ).rejects.toThrow();
  expect(h.calls).toEqual(["current:eth_sendTransaction"]);
  expect(release).not.toHaveBeenCalled();
  expect(uncertain).toHaveBeenCalledOnce();
});
