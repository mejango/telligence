import { fence, type TabLocks } from "@/lib/fence";
import {
  recordTransactionActivity,
  restoreUnsentPaymentActivity,
  updateTransactionActivity,
} from "@/lib/transaction-activity";

/**
 * The activity journal as one lock's holder writes it. The store is global and also written
 * outside any lock (a sent write's row), so work under a lock takes its own bound journal: each
 * write checks the lock first, and a tab whose lease passed on writes nothing.
 */
export function activityJournal(locks: TabLocks) {
  return {
    record: fence(locks, recordTransactionActivity),
    update: fence(locks, updateTransactionActivity),
    restoreUnsent: fence(locks, restoreUnsentPaymentActivity),
  };
}
