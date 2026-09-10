import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));

import { revalidateCacheTag } from "@/lib/cache";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("cache revalidation server action", () => {
  it("refuses any tag other than suckerTransactions without sleeping", async () => {
    for (const tag of ["", "projects", "suckerTransactions ", "*", 1, null]) {
      const start = Date.now();
      expect(await revalidateCacheTag(tag as string)).toBe(false);
      expect(Date.now() - start).toBe(0);
    }
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates the sucker transactions tag after its fixed delays", async () => {
    const result = revalidateCacheTag("suckerTransactions");
    await vi.advanceTimersByTimeAsync(7_999);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("suckerTransactions", "max");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toBe(true);
  });
});
