import { bendystrawNetworkFor } from "@/lib/bendystraw/client";
import { describe, expect, it } from "vitest";

describe("shared Bendystraw runtime policy", () => {
  it("routes nested filters through the SDK network resolver", () => {
    expect(
      bendystrawNetworkFor({
        where: { OR: [{ chainId: 1 }, { nested: { chainId_in: [10, 8453] } }] },
      }),
    ).toBe("mainnet");
    expect(bendystrawNetworkFor({ where: { chainId_in: [11155111, 84532] } })).toBe("testnet");
  });

  it("fails closed for mixed or unsupported chain scopes", () => {
    expect(() => bendystrawNetworkFor({ where: { chainId_in: [1, 11155111] } })).toThrow(
      "cannot mix mainnet and testnet",
    );
    expect(() => bendystrawNetworkFor({ where: { chainId: 999_999 } })).toThrow(
      "Unsupported Bendystraw chain ID",
    );
  });
});
