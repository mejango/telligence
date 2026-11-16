import { reviewedSendDeps, reviewedWalletOf } from "@/lib/reviewed-send-deps";
import { clearViewAs } from "@/lib/view-as";
import { beforeEach, expect, it, vi } from "vitest";
import type { Config } from "wagmi";

const state = vi.hoisted(() => ({
  account: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 1,
    connector: { id: "injected" },
  },
  safe: false,
  load: vi.fn(),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => state.account,
  getWalletClient: () => state.load(),
  getPublicClient: vi.fn(),
  switchChain: vi.fn(),
}));
vi.mock("@/lib/safe-connector", () => ({
  isSafeConnection: () => state.safe,
  safeWalletPeerSettled: async () => undefined,
}));
beforeEach(() => {
  clearViewAs();
  state.safe = false;
  state.account = {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 1,
    connector: { id: "injected" },
  };
  state.load.mockReset();
});

it.each(["direct payment", "ERC20 approval"])(
  "resolves the current wallet after awaited preparation for %s",
  async (kind) => {
    const config = {} as Config;
    const bound = reviewedWalletOf(config, state.account.address as `0x${string}`);
    const adapter = reviewedSendDeps(config, () => [bound]).adapter;
    const oldSend = vi.fn();
    const currentSend = vi.fn().mockResolvedValue("0x1234");
    const { viemWallet } = await import("./support/viem-wallet");
    state.load.mockResolvedValue(viemWallet({ sendTransaction: oldSend }, () => 1));
    // Model the held review/simulation completing after a connector switch.
    await Promise.resolve();
    state.account = { ...state.account, connector: { id: "walletConnect" } };
    state.load.mockResolvedValue(viemWallet({ sendTransaction: currentSend }, () => 1));
    await adapter.sendTransaction({
      chainId: 1,
      to: "0x2222222222222222222222222222222222222222",
      data: kind === "ERC20 approval" ? "0x095ea7b3" : "0x",
      value: 0n,
    });
    expect(currentSend).toHaveBeenCalledOnce();
    expect(oldSend).not.toHaveBeenCalled();
  },
);

it("refuses a saved custom-vote shop call before opening the current wallet", async () => {
  const { buildTierConfigs, newDraftItem } = await import("@/components/shop/itemDraft");
  const { jb721TiersHookAbi } = await import("@bananapus/nana-sdk-core");
  const { encodeFunctionData } = await import("viem");
  const tiers = buildTierConfigs([{ ...newDraftItem(), price: "1" }], 6);
  if (typeof tiers === "string") throw new Error(tiers);
  tiers[0].flags.useVotingUnits = true;
  const data = encodeFunctionData({
    abi: jb721TiersHookAbi,
    functionName: "adjustTiers",
    args: [tiers, []],
  });
  const adapter = reviewedSendDeps({} as Config).adapter;
  await expect(
    adapter.sendTransaction({
      chainId: 1,
      to: "0x2222222222222222222222222222222222222222",
      data,
      value: 0n,
    }),
  ).rejects.toThrow(/Rebuild/);
  expect(state.load).not.toHaveBeenCalled();
});

it.each(["signMessage", "signTypedData", "sendCalls"] as const)(
  "hands core's fence to the wallet request for %s, so a lost lock opens no wallet",
  async (method) => {
    const config = {} as Config;
    const adapter = reviewedSendDeps(config).adapter;
    const wallet = vi.fn().mockResolvedValue("0x1234");
    const { viemWallet } = await import("./support/viem-wallet");
    state.load.mockResolvedValue(viemWallet({ [method]: wallet }, () => 1));
    const lost = new Error("lock lost");
    const fence = vi.fn().mockRejectedValue(lost);
    const account = state.account.address as `0x${string}`;
    const request =
      method === "signMessage"
        ? adapter.signMessage("hello", { fence })
        : method === "signTypedData"
          ? adapter.signTypedData(
              {
                account,
                domain: { name: "x", chainId: 1 },
                types: { M: [{ name: "a", type: "uint256" }] },
                primaryType: "M",
                message: { a: 1n },
              } as never,
              { fence },
            )
          : adapter.sendCalls!(
              1,
              [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: 0n }],
              { fence },
            );
    await expect(request).rejects.toBeTruthy();
    expect(fence).toHaveBeenCalled();
    expect(wallet).not.toHaveBeenCalled();
  },
);
