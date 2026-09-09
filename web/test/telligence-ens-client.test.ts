import { getEnsPublicClient } from "@/lib/ensPublicClient.server";
import { getViemPublicClient, SUPPORTED_CHAINS, transports } from "@/lib/wagmiTransports";
import { describe, expect, it } from "vitest";

describe("Telligence ENS read boundary", () => {
  it("resolves Ethereum identity through a public client without enabling Ethereum wallet transactions", () => {
    const ens = getEnsPublicClient();
    expect(ens.chain?.id).toBe(1);
    expect(ens.account).toBeUndefined();
    expect(SUPPORTED_CHAINS.map((chain) => chain.id)).toEqual([8453]);
    expect(Object.keys(transports)).toEqual(["8453"]);
    expect(() => getViemPublicClient(1)).toThrow("Telligence uses Base only.");
  });
});
