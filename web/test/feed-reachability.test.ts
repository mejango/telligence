// Launch guard for INV-1: a configuration whose accounting contexts and base
// currency need a JBPrices conversion no feed can serve is bricked at runtime
// (USDC pays revert against an ETH base; mixed-balance cash-outs revert on the
// context <-> context conversion). The guard probes every required pair with
// project id 0 — the default-feed lookup a fresh project falls through to —
// and fails closed, so registering the missing default feed on-chain unblocks
// the combination without a client release.
import {
  assertLaunchFeedsReachable,
  requiredFeedPairs,
} from "@/app/create/helpers/feedReachability";
import { ETH_CURRENCY_ID, JB_CHAINS, NATIVE_TOKEN, USDC_ADDRESSES } from "@bananapus/nana-sdk-core";
import { JBCenterRequestError, JBCenterTimeoutError } from "@bananapus/nana-sdk-core/jbcenter";
import { NATIVE_TOKEN_CURRENCY_ID, tokenCurrencyId } from "@bananapus/nana-sdk-core/v6";
import { ContractFunctionRevertedError, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

const USDC = USDC_ADDRESSES[sepolia.id];
const USDC_CURRENCY = tokenCurrencyId(USDC);
const CHAIN_NAME = JB_CHAINS[sepolia.id].name;

const nativeContext = {
  token: NATIVE_TOKEN,
  decimals: 18,
  currency: NATIVE_TOKEN_CURRENCY_ID,
};
const usdcContext = { token: USDC, decimals: 6, currency: USDC_CURRENCY };

const feedNotFound = () =>
  new ContractFunctionRevertedError({
    abi: [],
    functionName: "pricePerUnitOf",
    message: "execution reverted",
  });

function clientWith(readContract: ReturnType<typeof vi.fn>): PublicClient {
  return { readContract } as unknown as PublicClient;
}

describe("requiredFeedPairs — the pairs the terminal resolves at runtime", () => {
  it("needs no pair when the sole context currency equals the base currency", () => {
    const custom = { token: USDC, decimals: 6, currency: USDC_CURRENCY };
    expect(requiredFeedPairs([custom], USDC_CURRENCY)).toEqual([]);
  });

  it("derives the pay pair for a single context priced in a standard-id base", () => {
    expect(requiredFeedPairs([nativeContext], ETH_CURRENCY_ID)).toEqual([
      { pricingCurrency: NATIVE_TOKEN_CURRENCY_ID, unitCurrency: ETH_CURRENCY_ID, decimals: 18 },
    ]);
  });

  it("derives pay pairs for every context plus the cash-out cross-context pair", () => {
    const pairs = requiredFeedPairs([nativeContext, usdcContext], ETH_CURRENCY_ID);
    expect(pairs).toEqual([
      { pricingCurrency: NATIVE_TOKEN_CURRENCY_ID, unitCurrency: ETH_CURRENCY_ID, decimals: 18 },
      { pricingCurrency: USDC_CURRENCY, unitCurrency: ETH_CURRENCY_ID, decimals: 6 },
      { pricingCurrency: NATIVE_TOKEN_CURRENCY_ID, unitCurrency: USDC_CURRENCY, decimals: 18 },
    ]);
  });

  it("dedupes a cross-context pair already required by the pay path, in either direction", () => {
    // Base equals one context's currency: the other context's pay pair IS the
    // cross-context pair (JBPrices resolves the inverse feed itself).
    const pairs = requiredFeedPairs([nativeContext, usdcContext], NATIVE_TOKEN_CURRENCY_ID);
    expect(pairs).toEqual([
      {
        pricingCurrency: USDC_CURRENCY,
        unitCurrency: NATIVE_TOKEN_CURRENCY_ID,
        decimals: 6,
      },
    ]);
  });
});

describe("assertLaunchFeedsReachable — fail-closed launch gate", () => {
  it("allows the launch when every required pair resolves on-chain", async () => {
    const readContract = vi.fn().mockResolvedValue(10n ** 18n);

    await expect(
      assertLaunchFeedsReachable({
        chainId: sepolia.id,
        publicClient: clientWith(readContract),
        contexts: [nativeContext, usdcContext],
        baseCurrency: ETH_CURRENCY_ID,
      }),
    ).resolves.toBeUndefined();

    // Probes use project id 0: the default-feed semantics a fresh project
    // resolves through at runtime.
    expect(readContract).toHaveBeenCalledTimes(3);
    for (const call of readContract.mock.calls) {
      expect(call[0].functionName).toBe("pricePerUnitOf");
      expect(call[0].args[0]).toBe(0n);
    }
  });

  it("skips probing entirely when no conversion is ever needed", async () => {
    const readContract = vi.fn();

    await assertLaunchFeedsReachable({
      chainId: sepolia.id,
      publicClient: clientWith(readContract),
      contexts: [usdcContext],
      baseCurrency: USDC_CURRENCY,
    });

    expect(readContract).not.toHaveBeenCalled();
  });

  it("blocks the launch and names the pair and chain when the ETH to USDC feed is missing", async () => {
    const readContract = vi.fn(async ({ args }: { args: readonly bigint[] }) => {
      const pair = [args[1], args[2]];
      if (pair.includes(BigInt(USDC_CURRENCY)) && pair.includes(BigInt(NATIVE_TOKEN_CURRENCY_ID))) {
        throw feedNotFound();
      }
      return 10n ** 18n;
    });

    await expect(
      assertLaunchFeedsReachable({
        chainId: sepolia.id,
        publicClient: clientWith(readContract),
        contexts: [nativeContext, usdcContext],
        baseCurrency: ETH_CURRENCY_ID,
      }),
    ).rejects.toThrow(new RegExp(`No price feed on ${CHAIN_NAME} converts ETH to USDC`));
  });

  it("blocks the ETH-base USDC pay pair too, naming USDC and the base", async () => {
    const readContract = vi.fn(async ({ args }: { args: readonly bigint[] }) => {
      const pair = [args[1], args[2]];
      if (pair.includes(BigInt(USDC_CURRENCY)) && pair.includes(BigInt(ETH_CURRENCY_ID))) {
        throw feedNotFound();
      }
      return 10n ** 18n;
    });

    await expect(
      assertLaunchFeedsReachable({
        chainId: sepolia.id,
        publicClient: clientWith(readContract),
        contexts: [nativeContext, usdcContext],
        baseCurrency: ETH_CURRENCY_ID,
      }),
    ).rejects.toThrow(new RegExp(`No price feed on ${CHAIN_NAME} converts USDC to ETH`));
  });

  it("fails closed on a transport failure without claiming the feed is missing", async () => {
    const readContract = vi.fn().mockRejectedValue(new Error("fetch failed"));

    await expect(
      assertLaunchFeedsReachable({
        chainId: sepolia.id,
        publicClient: clientWith(readContract),
        contexts: [nativeContext, usdcContext],
        baseCurrency: ETH_CURRENCY_ID,
      }),
    ).rejects.toThrow(
      /Couldn't verify the ETH to ETH price feed on Sepolia — Sepolia reads via juicebox.center were blocked before reaching the server/,
    );
  });

  it("names a rate limit, timeout, or HTTP failure from juicebox.center", async () => {
    const probe = (error: Error) =>
      assertLaunchFeedsReachable({
        chainId: sepolia.id,
        publicClient: clientWith(vi.fn().mockRejectedValue(error)),
        contexts: [nativeContext, usdcContext],
        baseCurrency: ETH_CURRENCY_ID,
      });
    await expect(probe(new JBCenterRequestError("rate limited", 429))).rejects.toThrow(
      /Sepolia reads via juicebox.center are rate-limited/,
    );
    await expect(probe(new JBCenterTimeoutError(15_000))).rejects.toThrow(
      /Sepolia reads via juicebox.center timed out/,
    );
    // viem wraps transport failures in ContractFunctionExecutionError → cause chain.
    const nested = new Error("outer", {
      cause: new Error("inner", { cause: new JBCenterRequestError("x", 502) }),
    });
    await expect(probe(nested)).rejects.toThrow(/failed with HTTP 502/);
  });
});
