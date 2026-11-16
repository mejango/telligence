import { mapConcurrentChecks } from "@/lib/concurrent-checks";
import { describe, expect, it, vi } from "vitest";

function deferred() {
  let resolve!: (value: number) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<number>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("concurrent checks", () => {
  it("starts every independent check without waiting for responses and preserves input order", async () => {
    const gates = Array.from({ length: 3 }, deferred);
    const check = vi.fn((index: number) => gates[index].promise);
    const result = mapConcurrentChecks([0, 1, 2], check);
    expect(check.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);
    gates[1].resolve(11);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(3));
    gates[2].resolve(12);
    gates[0].resolve(10);
    await expect(result).resolves.toEqual([10, 11, 12]);
  });

  it("drains outstanding and queued checks before surfacing failure", async () => {
    const gates = Array.from({ length: 3 }, deferred);
    const check = vi.fn((index: number) => gates[index].promise);
    let settled = false;
    const result = mapConcurrentChecks([0, 1, 2], check).catch((error) => {
      settled = true;
      return error;
    });
    const failure = new Error("stale nonce");
    gates[0].reject(failure);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(3));
    expect(settled).toBe(false);
    gates[2].resolve(12);
    await Promise.resolve();
    expect(settled).toBe(false);
    gates[1].resolve(11);
    await expect(result).resolves.toBe(failure);
  });
});
