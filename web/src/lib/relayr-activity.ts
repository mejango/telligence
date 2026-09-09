import type { TransactionActivity } from "@/lib/transaction-activity";

export function canCheckRelayrBundle(activity: TransactionActivity): boolean {
  return (
    activity.kind === "relayr-bundle" &&
    Boolean(activity.bundleUuid) &&
    activity.relayrPaymentStatus !== "unfunded" &&
    activity.relayrPaymentStatus !== "reverted" &&
    (activity.relayrPaymentStatus === "submitted" ||
      activity.relayrPaymentStatus === "confirmed" ||
      Boolean(activity.hash)) &&
    (activity.status === "submitted" ||
      activity.status === "pending" ||
      activity.status === "failed" ||
      activity.manualVerificationRequired === true)
  );
}
