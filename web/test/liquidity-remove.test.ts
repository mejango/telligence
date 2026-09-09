import { describeEditLiquidityPlan } from "@/app/[slug]/components/v6/owners/market/formView";
import {
  groupMarketPositions,
  lpBandPrices,
  lpDeadline,
  prepareAddLiquidity,
  prepareCollectLpFees,
  prepareCollectMarketFees,
  prepareEditLiquidity,
  prepareMarketEdit,
  prepareMarketLiquidity,
  prepareRemoveLiquidity,
  type PoolSnapshot,
  type UserLpPosition,
} from "@/app/[slug]/components/v6/owners/market/lib";
import {
  uniswapV4AmountsForLiquidity,
  uniswapV4LiquidityForAmounts,
  uniswapV4SqrtPriceX96AtTick,
} from "@bananapus/nana-sdk-core/v6";
import { decodeAbiParameters, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

const recipient = "0x1111111111111111111111111111111111111111";
const projectToken = "0x2222222222222222222222222222222222222222";

const pool = {
  chainId: 1,
  projectId: 1,
  hook: "0x3333333333333333333333333333333333333333",
  key: {
    currency0: zeroAddress,
    currency1: projectToken,
    fee: 3_000,
    tickSpacing: 60,
    hooks: "0x3333333333333333333333333333333333333333",
  },
  poolId: `0x${"44".repeat(32)}`,
  sqrtP: 1n,
  pair: { addr: zeroAddress, decimals: 18, symbol: "ETH", currency: 1 },
  pairIsC0: true,
  projectToken,
  price: 1,
  poolManager: "0x5555555555555555555555555555555555555555",
} as PoolSnapshot;

const position = {
  tokenId: 42n,
  owner: recipient,
  info: 1n,
  liquidity: 100n,
  tickLower: -60,
  tickUpper: 60,
  pairAmount: 1_000n,
  tokenAmount: 2_000n,
} as UserLpPosition;

describe("Revnet LP removal", () => {
  // wallet-action:remove-liquidity
  it("encodes a full burn and take-pair with exact 95% output floors", () => {
    const plan = prepareRemoveLiquidity(pool, position, recipient, false, 100);
    expect(plan.pairMinimum).toBe(950n);
    expect(plan.tokenMinimum).toBe(1_900n);
    expect(plan.deadline).toBe(1_300n);

    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    expect(actions).toBe("0x0311");
    const [tokenId, amount0Minimum, amount1Minimum] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
      params[0],
    );
    expect(tokenId).toBe(42n);
    expect(amount0Minimum).toBe(950n);
    expect(amount1Minimum).toBe(1_900n);
  });

  it("keeps positive dust returns protected by a nonzero minimum", () => {
    const plan = prepareRemoveLiquidity(
      pool,
      { ...position, pairAmount: 1n, tokenAmount: 1n },
      recipient,
      false,
      0,
    );
    expect(plan.pairMinimum).toBe(1n);
    expect(plan.tokenMinimum).toBe(1n);
  });

  // The deadline is stamped when the transaction is PROPOSED. A Safe collects
  // co-signatures for hours or days, so a 20-minute window guarantees the last
  // owner signs a call that can no longer execute.
  it("widens the deadline to 30 days for a Safe and keeps 20 minutes for an EOA", () => {
    expect(lpDeadline(false, 100)).toBe(BigInt(100 + 20 * 60));
    expect(lpDeadline(true, 100)).toBe(BigInt(100 + 30 * 24 * 60 * 60));
    expect(prepareRemoveLiquidity(pool, position, recipient, true, 100).deadline).toBe(
      BigInt(100 + 30 * 24 * 60 * 60),
    );
    expect(prepareCollectLpFees(pool, position, recipient, true, 100).deadline).toBe(
      BigInt(100 + 30 * 24 * 60 * 60),
    );
  });
});

describe("Revnet LP entry", () => {
  // wallet-action:add-liquidity
  // wallet-action:liquidity-management
  it("encodes a bounded mint with Permit2 token settlement and native refund", () => {
    const plan = prepareAddLiquidity(
      { ...pool, sqrtP: 2n ** 96n },
      {
        pairAmount: 1_000_000_000_000_000_000n,
        tokenAmount: 1_000_000_000_000_000_000n,
      },
      { minimumPrice: 0.5, maximumPrice: 2 },
      recipient,
    );

    expect(plan.liquidity).toBeGreaterThan(0n);
    expect(plan.value).toBe(plan.pairMaximum);
    expect(plan.erc20Sides).toEqual([{ currency: projectToken, max: plan.tokenMaximum }]);
    const [actions] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    expect(actions).toBe("0x02121214");
  });
});

// A live-looking position: price 1 (sqrtP = 2^96), a symmetric ±600-tick
// band, and holdings derived from its liquidity the way the position scan does.
const sqrtP = 2n ** 96n;
const livePool = { ...pool, sqrtP };
const sqrtA = uniswapV4SqrtPriceX96AtTick(-600);
const sqrtB = uniswapV4SqrtPriceX96AtTick(600);
const held = uniswapV4AmountsForLiquidity(sqrtP, sqrtA, sqrtB, 10n ** 18n);
const liquidity = uniswapV4LiquidityForAmounts(sqrtP, sqrtA, sqrtB, held.amount0, held.amount1);
const livePosition: UserLpPosition = {
  ...position,
  tickLower: -600,
  tickUpper: 600,
  liquidity,
  pairAmount: held.amount0,
  tokenAmount: held.amount1,
};
const modifyParams = [
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint128" },
  { type: "uint128" },
  { type: "bytes" },
] as const;

describe("Revnet LP edit", () => {
  // wallet-action:edit-liquidity
  it("tops up the same band with INCREASE_LIQUIDITY funded by the wallet", () => {
    const plan = prepareEditLiquidity(
      livePool,
      livePosition,
      { pairAmount: held.amount0 * 2n, tokenAmount: held.amount1 * 2n },
      null,
      recipient,
    );
    expect(plan.kind).toBe("increase");
    // Same position, same ticks, more liquidity.
    expect(plan.tokenId).toBe(42n);
    expect(plan.tickLower).toBe(-600);
    expect(plan.tickUpper).toBe(600);
    expect(plan.liquidity).toBeGreaterThan(liquidity);
    expect(plan.liquidity).toBe(liquidity + plan.liquidityDelta);
    // Targets are ceilings: the position ends up holding at most what was typed.
    expect(plan.pairHolding).toBeLessThanOrEqual(held.amount0 * 2n);
    expect(plan.tokenHolding).toBeLessThanOrEqual(held.amount1 * 2n);
    // The wallet pays the difference plus 1% headroom; native ETH is the pair.
    expect(plan.pairFlow).toBeGreaterThan(0n);
    expect(plan.tokenFlow).toBeGreaterThan(0n);
    expect(plan.pairFunding).toBe(plan.pairFlow + plan.pairFlow / 100n + 1n);
    expect(plan.tokenFunding).toBe(plan.tokenFlow + plan.tokenFlow / 100n + 1n);
    expect(plan.value).toBe(plan.pairFunding);
    expect(plan.erc20Sides).toEqual([{ currency: projectToken, max: plan.tokenFunding }]);
    expect(plan.pairMinimum).toBe(0n);
    expect(plan.mint).toBeNull();

    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    // INCREASE_LIQUIDITY, CLOSE_CURRENCY ×2, SWEEP (native refund).
    expect(actions).toBe("0x00121214");
    expect(params).toHaveLength(4);
    const [tokenId, added, amount0Max, amount1Max] = decodeAbiParameters(modifyParams, params[0]);
    expect(tokenId).toBe(42n);
    expect(added).toBe(plan.liquidityDelta);
    expect(amount0Max).toBe(plan.pairFunding);
    expect(amount1Max).toBe(plan.tokenFunding);
    expect(decodeAbiParameters([{ type: "address" }], params[1])).toEqual([zeroAddress]);
    expect(decodeAbiParameters([{ type: "address" }], params[2])).toEqual([projectToken]);
    expect(decodeAbiParameters([{ type: "address" }, { type: "address" }], params[3])).toEqual([
      zeroAddress,
      recipient,
    ]);
  });

  it("frees part of the same band with DECREASE_LIQUIDITY behind 95% floors", () => {
    const plan = prepareEditLiquidity(
      livePool,
      livePosition,
      { pairAmount: held.amount0 / 2n, tokenAmount: held.amount1 / 2n },
      null,
      recipient,
    );
    expect(plan.kind).toBe("decrease");
    expect(plan.liquidity).toBeLessThan(liquidity);
    expect(plan.liquidity).toBe(liquidity - plan.liquidityDelta);
    expect(plan.pairHolding).toBeLessThanOrEqual(held.amount0 / 2n);
    expect(plan.tokenHolding).toBeLessThanOrEqual(held.amount1 / 2n);
    // Nothing is pulled; the freed share comes back with a 95% floor.
    expect(plan.pairFlow).toBeLessThan(0n);
    expect(plan.tokenFlow).toBeLessThan(0n);
    expect(plan.pairFunding).toBe(0n);
    expect(plan.tokenFunding).toBe(0n);
    expect(plan.value).toBe(0n);
    expect(plan.erc20Sides).toEqual([]);
    expect(plan.pairMinimum).toBe((-plan.pairFlow * 9_500n) / 10_000n);
    expect(plan.tokenMinimum).toBe((-plan.tokenFlow * 9_500n) / 10_000n);

    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    // DECREASE_LIQUIDITY then TAKE_PAIR.
    expect(actions).toBe("0x0111");
    expect(params).toHaveLength(2);
    const [tokenId, freed, amount0Min, amount1Min] = decodeAbiParameters(modifyParams, params[0]);
    expect(tokenId).toBe(42n);
    expect(freed).toBe(plan.liquidityDelta);
    expect(amount0Min).toBe(plan.pairMinimum);
    expect(amount1Min).toBe(plan.tokenMinimum);
    expect(
      decodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }],
        params[1],
      ),
    ).toEqual([zeroAddress, projectToken, recipient]);
  });

  it("routes an all-zero target to the full-exit removal", () => {
    const plan = prepareEditLiquidity(
      livePool,
      livePosition,
      { pairAmount: 0n, tokenAmount: 0n },
      { minimumPrice: 0.5, maximumPrice: 2 },
      recipient,
    );
    expect(plan.kind).toBe("remove");
    expect(plan.liquidity).toBe(0n);
    expect(plan.pairFlow).toBe(-held.amount0);
    expect(plan.tokenFlow).toBe(-held.amount1);
    expect(plan.unlockData).toBe(
      prepareRemoveLiquidity(livePool, livePosition, recipient).unlockData,
    );
  });

  it("refuses a one-sided target on an in-range band instead of silently removing", () => {
    expect(() =>
      prepareEditLiquidity(
        livePool,
        livePosition,
        { pairAmount: held.amount0, tokenAmount: 0n },
        null,
        recipient,
      ),
    ).toThrow(/holds both/);
    expect(() =>
      prepareEditLiquidity(
        livePool,
        livePosition,
        { pairAmount: held.amount0, tokenAmount: held.amount1 },
        null,
        recipient,
      ),
    ).toThrow(/as it is/);
    // Holdings round-trip through liquidity with rounding; the untouched form
    // of a position whose liquidity is the onchain value must still be a no-op.
    expect(() =>
      prepareEditLiquidity(
        livePool,
        { ...livePosition, liquidity: 10n ** 18n },
        { pairAmount: held.amount0, tokenAmount: held.amount1 },
        null,
        recipient,
      ),
    ).toThrow(/as it is/);
  });

  it("re-mints into a new band with wallet capital on top of the burn credit", () => {
    const plan = prepareEditLiquidity(
      livePool,
      livePosition,
      { pairAmount: held.amount0 * 3n, tokenAmount: held.amount1 * 3n },
      { minimumPrice: 0.5, maximumPrice: 2 },
      recipient,
    );
    expect(plan.kind).toBe("move");
    expect(plan.mint).not.toBeNull();
    expect(plan.tickLower).toBe(plan.mint!.tickLower);
    expect(plan.liquidity).toBe(plan.mint!.liquidity);
    // The wallet funds only what the burn does not cover, with the mint's headroom.
    expect(plan.pairFlow).toBeGreaterThan(0n);
    expect(plan.tokenFlow).toBeGreaterThan(0n);
    expect(plan.pairFunding).toBe(plan.mint!.pairMaximum - held.amount0);
    expect(plan.tokenFunding).toBe(plan.mint!.tokenMaximum - held.amount1);
    expect(plan.value).toBe(plan.pairFunding);
    expect(plan.erc20Sides).toEqual([{ currency: projectToken, max: plan.tokenFunding }]);
    // Burn floors stay at 95% of the old holdings.
    expect(plan.pairMinimum).toBe((held.amount0 * 9_500n) / 10_000n);
    expect(plan.tokenMinimum).toBe((held.amount1 * 9_500n) / 10_000n);

    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    // BURN_POSITION, MINT_POSITION, CLOSE_CURRENCY ×2, SWEEP (native funding refund).
    expect(actions).toBe("0x0302121214");
    expect(params).toHaveLength(5);
    const [tokenId, amount0Minimum, amount1Minimum] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
      params[0],
    );
    expect(tokenId).toBe(42n);
    expect(amount0Minimum).toBe(plan.pairMinimum);
    expect(amount1Minimum).toBe(plan.tokenMinimum);
    // The embedded mint parameters are byte-identical to the add plan's.
    const [, addParams] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.mint!.unlockData,
    );
    expect(params[1]).toBe(addParams[0]);
  });

  it("moves a band with no wallet funding when the targets are the current holdings", () => {
    const plan = prepareEditLiquidity(
      livePool,
      livePosition,
      { pairAmount: held.amount0, tokenAmount: held.amount1 },
      { minimumPrice: 0.5, maximumPrice: 2 },
      recipient,
    );
    expect(plan.kind).toBe("move");
    // Sized inside the burn's proceeds (1% shave), so nothing is pulled.
    expect(plan.pairFlow).toBeLessThanOrEqual(0n);
    expect(plan.tokenFlow).toBeLessThanOrEqual(0n);
    expect(plan.pairFunding).toBe(0n);
    expect(plan.tokenFunding).toBe(0n);
    expect(plan.value).toBe(0n);
    expect(plan.erc20Sides).toEqual([]);
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    expect(actions).toBe("0x03021212");
    expect(params).toHaveLength(4);
  });

  it("maps a position's ticks back to display prices with min below max", () => {
    // pairIsC0 flips the axis: the lower tick is the HIGHER display price.
    const band = lpBandPrices(pool, -60, 60);
    expect(band.minimumPrice).toBeLessThan(band.maximumPrice);
    expect(band.minimumPrice).toBeCloseTo(1.0001 ** -60, 6);
    expect(band.maximumPrice).toBeCloseTo(1.0001 ** 60, 6);
  });

  it("words each kind of edit from the wallet's point of view", () => {
    const words = (kind: "increase" | "decrease" | "move" | "remove", flows: [bigint, bigint]) =>
      describeEditLiquidityPlan({
        kind,
        tokenId: 42n,
        tickLower: -600,
        tickUpper: 600,
        pairHolding: 10n ** 18n,
        tokenHolding: 2n * 10n ** 18n,
        tokenFlow: flows[0],
        pairFlow: flows[1],
        tokenFunding: flows[0] > 0n ? flows[0] + 1n : 0n,
        pairFunding: flows[1] > 0n ? flows[1] + 1n : 0n,
        tokenMinimum: 95n,
        pairMinimum: 95n,
        tokenSymbol: "ART",
        pairSymbol: "ETH",
        pairDecimals: 18,
        pairIsNative: true,
        band: "0.5 – 2 ETH/ART",
      });
    expect(words("increase", [10n ** 18n, 10n ** 18n]).lead).toMatch(
      /^Adds about 1 ART \+ 1 ETH from your wallet/,
    );
    expect(words("increase", [10n ** 18n, 10n ** 18n]).detail).toMatch(
      /authorizes up to .* — 1% price headroom; unused ETH is refunded/,
    );
    expect(words("decrease", [-(10n ** 18n), -(10n ** 18n)]).lead).toMatch(
      /^Frees about 1 ART \+ 1 ETH to your wallet/,
    );
    const move = words("move", [10n ** 18n, -(10n ** 18n)]);
    expect(move.lead).toMatch(/in the 0.5 – 2 ETH\/ART band/);
    expect(move.lead).toMatch(/pulls about 1 ART and gets back about 1 ETH/);
    expect(words("remove", [-(10n ** 18n), -(10n ** 18n)]).lead).toMatch(/^Burns position #42/);
  });
});

// A market at price 1: the token side sits in the ticks BELOW spot (pairIsC0
// flips the axis, so lower ticks are higher display prices) and the pair side
// in the ticks above it, with spot's own slot skipped between them.
const marketPool = { ...pool, sqrtP, price: 1 } as PoolSnapshot;
const tokenSideHeld = uniswapV4AmountsForLiquidity(
  sqrtP,
  uniswapV4SqrtPriceX96AtTick(-600),
  uniswapV4SqrtPriceX96AtTick(0),
  10n ** 18n,
);
const pairSideHeld = uniswapV4AmountsForLiquidity(
  sqrtP,
  uniswapV4SqrtPriceX96AtTick(60),
  uniswapV4SqrtPriceX96AtTick(600),
  10n ** 18n,
);
const tokenSide: UserLpPosition = {
  ...position,
  tokenId: 7n,
  tickLower: -600,
  tickUpper: 0,
  liquidity: 10n ** 18n,
  pairAmount: tokenSideHeld.amount0,
  tokenAmount: tokenSideHeld.amount1,
};
const pairSide: UserLpPosition = {
  ...position,
  tokenId: 8n,
  tickLower: 60,
  tickUpper: 600,
  liquidity: 10n ** 18n,
  pairAmount: pairSideHeld.amount0,
  tokenAmount: pairSideHeld.amount1,
};
const corridor = { floor: 0.5, ceiling: 2 };

describe("Revnet LP market", () => {
  // wallet-action:liquidity-management
  it("mints both sides of the corridor in one unlock with independent amounts", () => {
    const plan = prepareMarketLiquidity(
      marketPool,
      { tokenAmount: 10n ** 18n, pairAmount: 5n * 10n ** 17n },
      corridor,
      recipient,
    );
    expect(plan.tokenSide).not.toBeNull();
    expect(plan.pairSide).not.toBeNull();
    // Token side above spot on the display axis = ticks below spot here; pair side the other way.
    expect(plan.tokenSide!.tickUpper).toBeLessThanOrEqual(0);
    expect(plan.pairSide!.tickLower).toBeGreaterThan(0);
    // Each side uses ITS amount in full (single-sided), not a ratio of the two.
    expect(plan.tokenSide!.tokenMaximum).toBeGreaterThanOrEqual(10n ** 18n);
    expect(plan.pairSide!.pairMaximum).toBeGreaterThanOrEqual(5n * 10n ** 17n);
    expect(plan.tokenSide!.pairMaximum).toBeLessThanOrEqual(1n);
    expect(plan.pairSide!.tokenMaximum).toBeLessThanOrEqual(1n);
    // Native pair funds via msg.value, the project token via one merged Permit2 allowance.
    expect(plan.value).toBe(plan.tokenSide!.value + plan.pairSide!.value);
    expect(plan.value).toBeGreaterThanOrEqual(plan.pairSide!.pairMaximum);
    expect(plan.erc20Sides).toEqual([
      { currency: projectToken, max: plan.tokenSide!.tokenMaximum },
    ]);

    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    // MINT, MINT, CLOSE ×2, SWEEP.
    expect(actions).toBe("0x0202121214");
    expect(params).toHaveLength(5);
    const [, tokenMint] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.tokenSide!.unlockData,
    );
    const [, pairMint] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.pairSide!.unlockData,
    );
    expect(params[0]).toBe(tokenMint[0]);
    expect(params[1]).toBe(pairMint[0]);
  });

  it("omits the side spot has left and refuses an empty market", () => {
    const aboveSpot = prepareMarketLiquidity(
      marketPool,
      { tokenAmount: 10n ** 18n, pairAmount: 5n * 10n ** 17n },
      { floor: 2, ceiling: 4 },
      recipient,
    );
    expect(aboveSpot.tokenSide).not.toBeNull();
    expect(aboveSpot.pairSide).toBeNull();
    expect(() =>
      prepareMarketLiquidity(marketPool, { tokenAmount: 0n, pairAmount: 0n }, corridor, recipient),
    ).toThrow(/at least one side/);
    expect(() =>
      prepareMarketLiquidity(
        marketPool,
        { tokenAmount: 0n, pairAmount: 10n ** 18n },
        { floor: 2, ceiling: 4 },
        recipient,
      ),
    ).toThrow(/outside the pair side/);
  });

  it("claims both sides' fees with one take", () => {
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      prepareCollectMarketFees(marketPool, [7n, 8n], recipient).unlockData,
    );
    expect(actions).toBe("0x010111");
    expect(params).toHaveLength(3);
    expect(decodeAbiParameters(modifyParams, params[1])[0]).toBe(8n);
    expect(decodeAbiParameters(modifyParams, params[1])[1]).toBe(0n);
  });

  it("groups two bands that meet at spot into one market and leaves the rest alone", () => {
    const lone: UserLpPosition = { ...position, tokenId: 9n, tickLower: 1200, tickUpper: 1800 };
    const groups = groupMarketPositions(marketPool, [pairSide, lone, tokenSide]);
    expect(groups).toEqual([
      { kind: "market", tokenSide, pairSide },
      { kind: "single", position: lone },
    ]);
    // A gap wider than one tick spacing is two unrelated positions.
    const far: UserLpPosition = { ...pairSide, tokenId: 10n, tickLower: 120 };
    expect(groupMarketPositions(marketPool, [tokenSide, far]).map((g) => g.kind)).toEqual([
      "single",
      "single",
    ]);
  });

  it("edits each side in place under one settlement", () => {
    const plan = prepareMarketEdit(
      marketPool,
      { tokenSide, pairSide },
      { tokenAmount: tokenSide.tokenAmount * 2n, pairAmount: pairSide.pairAmount / 2n },
      corridor,
      false,
      recipient,
    );
    expect(plan.token?.kind).toBe("increase");
    expect(plan.pair?.kind).toBe("decrease");
    expect(plan.token?.tokenId).toBe(7n);
    expect(plan.pair?.tokenId).toBe(8n);
    expect(plan.tokenFlow).toBeGreaterThan(0n);
    expect(plan.pairFlow).toBeLessThan(0n);
    expect(plan.pairMinimum).toBe((-plan.pairFlow * 9_500n) / 10_000n);
    expect(plan.erc20Sides).toEqual([{ currency: projectToken, max: plan.tokenFunding }]);
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    // INCREASE (token side), DECREASE (pair side), CLOSE ×2, SWEEP (the increase's 1-wei native max).
    expect(actions).toBe("0x0001121214");
    expect(params).toHaveLength(5);
  });

  it("re-fits both sides to a moved corridor by burning and re-minting each", () => {
    const plan = prepareMarketEdit(
      marketPool,
      { tokenSide, pairSide },
      { tokenAmount: tokenSide.tokenAmount, pairAmount: pairSide.pairAmount },
      { floor: 0.25, ceiling: 4 },
      true,
      recipient,
    );
    expect(plan.refit).toBe(true);
    expect(plan.token?.kind).toBe("move");
    expect(plan.pair?.kind).toBe("move");
    // Sized inside each burn's credit, so nothing but dust headroom is pulled.
    expect(plan.tokenFunding).toBe(0n);
    expect(plan.tokenFlow).toBeLessThanOrEqual(0n);
    expect(plan.pairFlow).toBeLessThanOrEqual(0n);
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    expect(actions.startsWith("0x03020302")).toBe(true);
    expect(params.length).toBeGreaterThanOrEqual(6);
  });

  it("removes one side, keeps an unchanged side, and mints a missing side", () => {
    const removeToken = prepareMarketEdit(
      marketPool,
      { tokenSide, pairSide },
      { tokenAmount: 0n, pairAmount: pairSide.pairAmount },
      corridor,
      false,
      recipient,
    );
    expect(removeToken.token?.kind).toBe("remove");
    expect(removeToken.pair?.kind).toBe("keep");
    expect(removeToken.pairFlow).toBe(0n);
    expect(
      decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], removeToken.unlockData)[0],
    ).toBe("0x031212");

    const mintToken = prepareMarketEdit(
      marketPool,
      { tokenSide: null, pairSide },
      { tokenAmount: 10n ** 18n, pairAmount: pairSide.pairAmount },
      corridor,
      false,
      recipient,
    );
    expect(mintToken.token?.kind).toBe("mint");
    expect(mintToken.token?.tokenId).toBeNull();
    expect(mintToken.pair?.kind).toBe("keep");
    expect(mintToken.erc20Sides).toEqual([{ currency: projectToken, max: mintToken.tokenFunding }]);
    expect(
      decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], mintToken.unlockData)[0],
    ).toBe("0x02121214");

    expect(() =>
      prepareMarketEdit(
        marketPool,
        { tokenSide, pairSide },
        { tokenAmount: tokenSide.tokenAmount, pairAmount: pairSide.pairAmount },
        corridor,
        false,
        recipient,
      ),
    ).toThrow(/as it is/);
  });
});

describe("Review-dialog V4 plan decoding", () => {
  it("renders a move plan as readable burn/mint/close steps", async () => {
    const { describeV4UnlockData } = await import("@/components/TransactionReviewProvider");
    const plan = prepareEditLiquidity(
      livePool,
      livePosition,
      { pairAmount: held.amount0, tokenAmount: held.amount1 },
      { minimumPrice: 0.25, maximumPrice: 4 },
      recipient,
    );
    const steps = describeV4UnlockData(plan.unlockData)! as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({
      action: "BURN_POSITION",
      position: "#42",
      minimumOut: { currency0: plan.pairMinimum, currency1: plan.tokenMinimum },
    });
    expect(steps[1]).toMatchObject({
      action: "MINT_POSITION",
      owner: recipient,
      ticks: { lower: plan.tickLower, upper: plan.tickUpper },
      liquidity: plan.liquidity,
    });
    expect(steps[2]).toMatchObject({ action: "CLOSE_CURRENCY", currency: zeroAddress });
    expect(steps[3]).toMatchObject({ action: "CLOSE_CURRENCY" });
    // Unknown actions must fall back to the raw view, never a partial story.
    expect(describeV4UnlockData("0xdead")).toBeNull();
  });

  it("renders a top-up as an increase step with its maxima", async () => {
    const { describeV4UnlockData } = await import("@/components/TransactionReviewProvider");
    const plan = prepareEditLiquidity(
      livePool,
      livePosition,
      { pairAmount: held.amount0 * 2n, tokenAmount: held.amount1 * 2n },
      null,
      recipient,
    );
    const steps = describeV4UnlockData(plan.unlockData)! as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({
      action: "INCREASE_LIQUIDITY",
      position: "#42",
      liquidity: plan.liquidityDelta,
      maximumIn: { currency0: plan.amount0Max, currency1: plan.amount1Max },
    });
    expect(steps[3]).toMatchObject({ action: "SWEEP", currency: zeroAddress, recipient });
  });
});
