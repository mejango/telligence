import { quoteDirectSellSwap } from "@/lib/directPaySwap";
import { NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import type { CashOutRoute, UniswapV4PoolKey } from "@bananapus/nana-sdk-core/v6";
import type { Address, PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const { quoteMock } = vi.hoisted(() => ({ quoteMock: vi.fn() }));

vi.mock("@bananapus/nana-sdk-core/v6/uniswap-v4", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6/uniswap-v4")>()),
  quoteUniswapV4ExactInputSingle: quoteMock,
}));

const token = "0x1111111111111111111111111111111111111111" as Address;
const poolKey = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: token,
  fee: 3_000,
  tickSpacing: 60,
  hooks: "0x2222222222222222222222222222222222222222",
} as UniswapV4PoolKey;

const cashOutRoute = (expectedReturn: bigint): CashOutRoute => ({
  route: "treasury",
  expectedReturn,
  minimumReturn: expectedReturn,
  terminalMinimum: expectedReturn,
  metadata: "0x",
  treasuryGross: expectedReturn,
  treasuryProtocolFee: 0n,
  treasuryNet: expectedReturn,
  buyback: null,
});

describe("Revnet direct-sell best execution", () => {
  // wallet-action:cash-out
  it("selects the pool only when its slippage-protected minimum beats cashing out", async () => {
    quoteMock.mockResolvedValue(200n);
    const selected = await quoteDirectSellSwap({
      client: {} as PublicClient,
      chainId: 1,
      poolKey,
      projectToken: token,
      tokenToReclaim: NATIVE_TOKEN,
      amount: 100n,
      cashOutRoute: cashOutRoute(197n),
      slippageBps: 100,
    });
    expect(selected).toMatchObject({
      zeroForOne: false,
      quotedOutput: 200n,
      minimumOutput: 198n,
    });

    await expect(
      quoteDirectSellSwap({
        client: {} as PublicClient,
        chainId: 1,
        poolKey,
        projectToken: token,
        tokenToReclaim: NATIVE_TOKEN,
        amount: 100n,
        cashOutRoute: cashOutRoute(198n),
        slippageBps: 100,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed for an invalid tolerance or a token outside the pool", async () => {
    await expect(
      quoteDirectSellSwap({
        client: {} as PublicClient,
        chainId: 1,
        poolKey,
        projectToken: token,
        tokenToReclaim: NATIVE_TOKEN,
        amount: 100n,
        cashOutRoute: cashOutRoute(0n),
        slippageBps: 10_001,
      }),
    ).resolves.toBeNull();
    await expect(
      quoteDirectSellSwap({
        client: {} as PublicClient,
        chainId: 1,
        poolKey,
        projectToken: "0x3333333333333333333333333333333333333333",
        tokenToReclaim: NATIVE_TOKEN,
        amount: 100n,
        cashOutRoute: cashOutRoute(0n),
        slippageBps: 100,
      }),
    ).resolves.toBeNull();
    await expect(
      quoteDirectSellSwap({
        client: {} as PublicClient,
        chainId: 1,
        poolKey,
        projectToken: token,
        tokenToReclaim: "0x4444444444444444444444444444444444444444",
        amount: 100n,
        cashOutRoute: cashOutRoute(0n),
        slippageBps: 100,
      }),
    ).resolves.toBeNull();
    expect(quoteMock).not.toHaveBeenCalled();
  });
});
