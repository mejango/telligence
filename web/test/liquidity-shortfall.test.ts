import { describe, expect, it } from "vitest";

import { liquidityShortfall } from "@/app/[slug]/components/v6/owners/market/lib";

describe("the wallet balance gate", () => {
  const plan = { tokenFlow: 10n, tokenFunding: 12n, pairFlow: 5n, pairFunding: 6n, value: 0n };
  it("gates an increase on what the pool pulls and a capped change on its whole cap", () => {
    expect(liquidityShortfall(plan, false, { token: 10n, pair: 5n })).toBeNull();
    expect(liquidityShortfall(plan, true, { token: 11n, pair: 6n })).toBe("token");
    expect(liquidityShortfall(plan, true, { token: 12n, pair: 5n })).toBe("pair");
    expect(liquidityShortfall(plan, false, undefined)).toBe("unread");
  });
  it("needs the whole native value sent, and reads no balance for a withdrawal", () => {
    const native = {
      tokenFlow: 0n,
      tokenFunding: 0n,
      pairFlow: 100n,
      pairFunding: 101n,
      value: 101n,
    };
    expect(liquidityShortfall(native, false, { token: 0n, pair: 100n })).toBe("pair");
    expect(liquidityShortfall(native, false, { token: 0n, pair: 101n })).toBeNull();
    const out = { tokenFlow: -3n, tokenFunding: 0n, pairFlow: -1n, pairFunding: 0n, value: 0n };
    expect(liquidityShortfall(out, false, undefined)).toBeNull();
  });
});
