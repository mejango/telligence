import { expect, it, vi } from "vitest";
import type { Config } from "wagmi";
import { ACCOUNT } from "./relayr-fixtures";

const captured = vi.hoisted(() => ({
  store: null as null | {
    withLock: <T>(account: string, run: (locks?: readonly unknown[]) => Promise<T>) => Promise<T>;
  },
}));
vi.mock("@bananapus/nana-sdk-core/review/safe-relayr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review/safe-relayr")>()),
  createSafeRelayrController: (options: { store: typeof captured.store }) => {
    captured.store = options.store;
    return {};
  },
}));

it("hands core both Safe Relayr locks, so its saves, signatures and wallet check them", async () => {
  const { safeRelayrController } = await import("@/lib/safe-relayr");
  safeRelayrController({} as Config);
  const run = vi.fn(async (_locks?: readonly unknown[]) => "ran");
  await expect(captured.store!.withLock(ACCOUNT, run)).resolves.toBe("ran");
  const [locks] = run.mock.calls[0]!;
  expect(locks?.map((lock) => (lock as { name: string }).name)).toEqual([
    "revnet:safe-relayr-lifecycle",
    `revnet:relayr-authorizations:${ACCOUNT.toLowerCase()}`,
  ]);
  for (const lock of locks ?? [])
    expect(typeof (lock as { assertHeld?: unknown }).assertHeld).toBe("function");
});
