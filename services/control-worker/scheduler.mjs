import { setTimeout as delay } from 'node:timers/promises';
import { safeErrorCode } from './errors.mjs';

/**
 * One independent loop. Capacity observation and slow maintenance (receipt
 * audits, keeper execution, planning) each get their own loop so a stalled RPC
 * or provider call in one cannot starve the other. They only share the database.
 */
export function runLoop({ name, everyMs, run, signal, log = () => {} }) {
  const state = { lastSuccess: 0, done: null };
  state.done = (async () => {
    while (!signal.aborted) {
      try {
        await run();
        state.lastSuccess = Date.now();
      } catch (error) {
        state.lastSuccess = 0;
        log({ event: `${name}_loop_failed`, code: safeErrorCode(error) });
      }
      try { await delay(everyMs, undefined, { signal }); } catch { /* shutdown */ }
    }
  })();
  return state;
}
