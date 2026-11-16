import { assertLocksHeld, type LockHandle } from "@bananapus/nana-sdk-core/review/locks";

/** The cross-tab locks a piece of work runs under: each of its journal writes checks them first. */
export type TabLocks = readonly LockHandle[];

/**
 * A journal's `write` bound to the locks it runs under: it writes only once every one still reads
 * as held (`LockLostError` otherwise), so a tab whose lease passed to another tab never overwrites
 * that tab's journal.
 */
export const fence =
  <A extends unknown[], R>(locks: TabLocks, write: (...args: A) => R) =>
  async (...args: A): Promise<R> => {
    await assertLocksHeld(locks);
    return write(...args);
  };
