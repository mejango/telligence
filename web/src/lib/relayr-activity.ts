import type { TransactionActivity } from "@/lib/transaction-activity";
import {
  relayrSignedRequests,
  type RelayrSentPayment,
} from "@bananapus/nana-sdk-core/review/relayr";

/** Legacy journal namespace shared by workflow and Safe lifecycle adapters. */
export function relayrRecoveryScopeKey(account: string, scope: string): string {
  return `${account.toLowerCase()}:relayr-scope:${scope}`;
}

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

/**
 * The forward requests a Relayr session published, each with the nonce it was
 * signed with when it saved them. Null when one is a raw or Safe call: it has
 * no forwarder nonce to classify, so it never counts as dead.
 */
export function relayrSessionRequests(activity: TransactionActivity) {
  return relayrSignedRequests(
    activity.relayrExpectedTransactions?.map(({ chainId, target, data, value }) => ({
      chain: chainId,
      target,
      data,
      value,
    })),
    activity.relayrNonces,
  );
}

type SentPayment = NonNullable<TransactionActivity["relayrPayments"]>[number];

/**
 * A session's payments as it saves them, oldest first. A row that lists none
 * names its one payment by `hash`.
 */
export function sentPayments(activity: TransactionActivity | undefined): SentPayment[] {
  if (activity?.relayrPayments?.length) return activity.relayrPayments;
  return activity?.hash && activity.relayrPayment && activity.chainId
    ? [{ hash: activity.hash, chainId: activity.chainId, ...activity.relayrPayment }]
    : [];
}

/**
 * A session's quote as the SDK's reverted-quote rules read it (revertedRelayrQuote,
 * requireRelayrRetry, proveSavedRelayrPayment, relayrRetryOption): the one place a
 * saved payment becomes a RelayrSentPayment. Its `calldata` and `amount` are the
 * saved `data` and `value`, and its deadline is the deadline word of that calldata
 * (the payment contract's selector, the bundle's ID word, then the deadline), which
 * the SDK binds a saved payment's deadline to. Calldata that has no such word leaves
 * the deadline empty, so the SDK refuses the payment and holds the quote.
 */
export function relayrSavedQuote(activity: TransactionActivity) {
  const bundleUuid = activity.bundleUuid?.toLowerCase() ?? "";
  const payments: RelayrSentPayment[] = sentPayments(activity).map((payment) => ({
    hash: payment.hash,
    chainId: payment.chainId,
    target: payment.target,
    calldata: payment.data,
    amount: payment.value,
    deadline: /^0x[0-9a-f]{136}$/iu.test(payment.data)
      ? BigInt(`0x${payment.data.slice(74)}`).toString()
      : "",
    bundleUuid,
  }));
  return {
    bundleUuid,
    payments,
    options: activity.relayrQuote?.payment_info ?? [],
    destinationChainIds: activity.relayrExpectedTransactions?.map(({ chainId }) => chainId) ?? [],
    account: activity.account ?? "",
  };
}

/**
 * A session awaiting its payment whose signatures the account view can check
 * at a finalized block (ruling R114 (e)).
 */
export function canCheckRelayrSignatures(activity: TransactionActivity): boolean {
  return (
    activity.kind === "relayr-bundle" &&
    !activity.relayrDiscardable &&
    (activity.relayrPaymentStatus === "unfunded" || activity.relayrPaymentStatus === "reverted") &&
    !!relayrSessionRequests(activity)
  );
}
