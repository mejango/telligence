import { activityJournal } from "@/lib/activity-journal";
import { fence } from "@/lib/fence";
import { refreshTransactionActivities } from "@/lib/transaction-activity";
import { LockLostError, type LockHandle } from "@bananapus/nana-sdk-core/review/locks";
import { beforeEach, expect, it, vi } from "vitest";

const lock = (held: boolean): LockHandle => ({
  name: "revnet:test",
  mode: "exclusive",
  signal: held ? new AbortController().signal : AbortSignal.abort(),
  held: async () => held,
  assertHeld: async () => {
    if (!held) throw new LockLostError("revnet:test");
  },
});

beforeEach(() => window.localStorage.clear());

it("writes only while every lock still reads as held", async () => {
  const write = vi.fn((value: number) => value * 2);
  await expect(fence([lock(true)], write)(2)).resolves.toBe(4);
  await expect(fence([lock(true), lock(false)], write)(3)).rejects.toBeInstanceOf(LockLostError);
  expect(write).toHaveBeenCalledOnce();
});

it("binds the activity journal to the lock its work runs under", async () => {
  const row = { id: "a", kind: "direct", title: "T", status: "pending", message: "m" } as const;
  await expect(activityJournal([lock(false)]).record(row)).rejects.toBeInstanceOf(LockLostError);
  expect(refreshTransactionActivities()).toEqual([]);
  await activityJournal([lock(true)]).record(row);
  expect(refreshTransactionActivities()).toEqual([expect.objectContaining({ id: "a" })]);
});
