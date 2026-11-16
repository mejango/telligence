// @vitest-environment node

import { readEach } from "@/lib/read-each";
import { encodeFunctionResult, erc20Abi, type Address, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const GOOD = "0x0000000000000000000000000000000000000001" as Address;
const HOSTILE = "0x0000000000000000000000000000000000000002" as Address;
const reads = [GOOD, HOSTILE].map((address) => ({
  address,
  abi: erc20Abi,
  functionName: "symbol",
}));

function client({ batch, node = true }: { batch: "ok" | "out-of-gas"; node?: boolean }) {
  const call = vi.fn(async ({ to }: { to: Address; batch?: boolean }) => {
    if (to === HOSTILE) throw new Error("out of gas");
    return {
      data: encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: "GOOD" }),
    };
  });
  return {
    call,
    multicall: vi.fn(async () => {
      if (batch === "out-of-gas") throw new Error("out of gas");
      return [{ status: "success", result: "GOOD" }];
    }),
    getBlockNumber: vi.fn(async () => {
      if (!node) throw new Error("node down");
      return 1n;
    }),
  };
}

describe("reads of contracts someone else controls", () => {
  it("takes the multicall's results when the batch survives", async () => {
    const fake = client({ batch: "ok" });
    await expect(readEach(fake as unknown as PublicClient, reads.slice(0, 1))).resolves.toEqual([
      { status: "success", result: "GOOD" },
    ]);
    expect(fake.call).not.toHaveBeenCalled();
  });

  it("reads each alone, unbatched, when one callee burns the whole batch's gas", async () => {
    const fake = client({ batch: "out-of-gas" });
    const results = await readEach(fake as unknown as PublicClient, reads);
    expect(results[0]).toEqual({ status: "success", result: "GOOD" });
    expect(results[1]).toMatchObject({ status: "failure" });
    expect(fake.call.mock.calls.every(([request]) => request.batch === false)).toBe(true);
  });

  it("rethrows the batch's error when the node itself is down", async () => {
    const fake = client({ batch: "out-of-gas", node: false });
    await expect(readEach(fake as unknown as PublicClient, reads)).rejects.toThrow("out of gas");
    expect(fake.call).not.toHaveBeenCalled();
  });
});
