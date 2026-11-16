import type { ReviewedRelayrRequest } from "@/hooks/useReviewedRelayr";
import { verifyActionReceipt, verifyCallPreconditions } from "@/lib/multichain-guards";
import type { ChainPayment, JBChainId, RelayrPostBundleResponse } from "@/lib/nana/types";
import { verifyMetadataSource } from "@/lib/project-metadata-write";
import { relayrRecoveryScopeKey, relayrSavedQuote } from "@/lib/relayr-activity";
import { loadEngine, reviewedSendDeps, reviewedWalletAdapter } from "@/lib/reviewed-send-deps";
import { isSafeConnection } from "@/lib/safe-connector";
import { SAFE_EXEC_ABI } from "@/lib/safe-service-config";
import {
  dismissTransactionActivity,
  recordTransactionActivity,
  refreshTransactionActivities,
  requireTransactionActivityPersistence,
  type RelayrExpectedTransaction,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import { requireNoViewAs } from "@/lib/view-as";
import {
  browserLocks,
  gasWithHeadroom,
  simulateStateChangingTransaction,
} from "@bananapus/nana-sdk-core/review";
import { RELAYR_NATIVE_TOKEN, type RelayrQuote } from "@bananapus/nana-sdk-core/review/relayr";
import {
  createSafeRelayrController,
  requireSafeRelayrExecution,
  SAFE_RELAYR_FUNDING_EXIT_LINE,
  safeRelayrPreconditions,
  safeRelayrReservationKey,
  type SafeRelayrExecution,
  type SafeRelayrProgress,
  type SafeRelayrSession,
} from "@bananapus/nana-sdk-core/review/safe-relayr";
import { decodeFunctionResult, zeroAddress, type Address } from "viem";
import type { Config } from "wagmi";
import { getAccount, getPublicClient } from "wagmi/actions";

type ExecutionContext = {
  expected: RelayrExpectedTransaction;
  review?: ReviewedRelayrRequest["review"];
  recoveryScope?: string;
};
type SessionContext = { activity?: TransactionActivity };
const authorizing = new Set<string>();
const LEGACY_RELEASE_MESSAGE =
  "This unpaid Relayr quote expired. Review the action again for a new quote.";

function requireRecoveryArray(value: unknown): void {
  if (value !== undefined && !Array.isArray(value))
    throw new Error(
      "A saved Safe bundle has malformed recovery history. Keep its recovery record and verify the existing bundle before continuing.",
    );
}

/** The earlier adapter wrote this exact record after the SDK canceled before POST. */
function legacyUnpublishedRelease(
  activity: TransactionActivity,
  executions: SafeRelayrExecution[],
): boolean {
  if (
    activity.relayrSafeState !== undefined ||
    activity.relayrSafeReleaseReason !== undefined ||
    activity.relayrSafeReservationKeys?.length ||
    !activity.relayrSafeSessionId ||
    activity.id !== activity.relayrSafeSessionId ||
    activity.title !== "Safe execution bundle" ||
    activity.status !== "failed" ||
    activity.message !== LEGACY_RELEASE_MESSAGE ||
    activity.relayrPaymentStatus !== "unfunded" ||
    activity.bundleUuid ||
    activity.relayrQuote ||
    activity.hash ||
    activity.executionHash ||
    activity.safeProposalHash ||
    activity.safeProposal ||
    activity.executionSeenAt ||
    activity.chainId ||
    activity.chainStates?.length ||
    activity.relayrNonces?.length ||
    activity.relayrPayment ||
    activity.relayrPayments?.length ||
    activity.relayrSafeFundingUnknown ||
    activity.relayrSafeFundingObserved ||
    activity.manualVerificationRequired ||
    activity.relayrDiscardable ||
    !executions.length ||
    executions.length !== activity.relayrExpectedTransactions?.length ||
    activity.relayrExpectedTransactions.some((execution) => execution.transactionUuid !== "")
  )
    return false;
  try {
    executions.forEach(requireSafeRelayrExecution);
    return true;
  } catch {
    return false;
  }
}

/** Existing activity records remain the persistence format; the SDK owns their lifecycle. */
export function safeRelayrSession(activity: TransactionActivity): SafeRelayrSession | undefined {
  const expected = activity.relayrExpectedTransactions;
  requireRecoveryArray(activity.relayrSafeReservationKeys);
  const reservationKeys = [
    ...(activity.relayrSafeReservationKeys ?? []),
    ...(activity.relayrCallKeys ?? []).flatMap((key) => {
      const match = key.match(/:relayr-scope:safe-execution:(\d+:0x[0-9a-f]{40}:\d+)$/i);
      return match ? [match[1].toLowerCase()] : [];
    }),
  ];
  const safeExpected = expected?.filter((row) => row.expectedSafeExecution) ?? [];
  if (activity.kind !== "relayr-bundle" || (!safeExpected.length && !reservationKeys.length))
    return undefined;
  // Storage predates the current schema. Never normalize malformed history into
  // an empty array: that would falsely prove this attempt was never funded.
  [
    activity.relayrPayments,
    activity.chainStates,
    activity.relayrNonces,
    activity.relayrCallKeys,
  ].forEach(requireRecoveryArray);
  if (!activity.account)
    throw new Error(
      "A saved Safe bundle is missing its account. Keep its recovery record and verify the existing bundle before continuing.",
    );
  const completeIdentity = !!expected?.length && safeExpected.length === expected.length;
  const executions = safeExpected.map((row): SafeRelayrExecution => ({
    entry: { chain: row.chainId, target: row.target, data: row.data, value: row.value },
    ...row.expectedSafeExecution!,
    context: { expected: row } satisfies ExecutionContext,
  }));
  const payments = relayrSavedQuote(activity).payments;
  const fundingEvidence = Boolean(
    activity.hash ||
    activity.executionHash ||
    activity.relayrPayment ||
    activity.relayrPayments?.length ||
    activity.chainStates?.some((row) => row.hash),
  );
  const fundingUnknown = Boolean(
    activity.relayrSafeFundingUnknown ||
    (!activity.relayrSafeSessionId && activity.relayrPaymentStatus === "submitted") ||
    (activity.relayrPaymentStatus === "unfunded" && fundingEvidence) ||
    (activity.hash &&
      !payments.some((payment) => payment.hash.toLowerCase() === activity.hash!.toLowerCase())),
  );
  const quote: RelayrQuote | undefined =
    completeIdentity && activity.bundleUuid
      ? {
          bundle_uuid: activity.bundleUuid,
          payment_info: activity.relayrQuote?.payment_info ?? [],
          transactions: safeExpected.map((row) => ({
            tx_uuid: row.transactionUuid,
            request: { chain: row.chainId, target: row.target, data: row.data, value: row.value },
          })),
          expectedTransactions: safeExpected.map((row) => ({
            txUuid: row.transactionUuid,
            chain: row.chainId,
            entry: { chain: row.chainId, target: row.target, data: row.data, value: row.value },
          })),
        }
      : undefined;
  const savedState =
    activity.relayrSafeState ??
    (legacyUnpublishedRelease(activity, executions) ||
    activity.relayrPaymentStatus === "expired" ||
    activity.relayrDiscardable === "expired" ||
    activity.relayrDiscardable === "changed"
      ? "released"
      : activity.status === "success" && !activity.manualVerificationRequired
        ? "complete"
        : activity.bundleUuid
          ? "active"
          : "publishing");
  return {
    id: activity.relayrSafeSessionId ?? activity.id,
    account: activity.account,
    executions,
    reservationKeys: [
      ...new Set([
        ...reservationKeys,
        ...executions.map(safeRelayrReservationKey),
        ...(!completeIdentity
          ? executions.map(
              (execution) => `${execution.entry.chain}:${execution.safe.toLowerCase()}:*`,
            )
          : []),
      ]),
    ],
    quote,
    bundleUuid: activity.bundleUuid,
    paymentStatus: fundingUnknown ? "sending" : (activity.relayrPaymentStatus ?? "sending"),
    payments,
    fundingObserved: activity.relayrSafeFundingObserved,
    records: activity.chainStates?.map((row) => ({
      chain: row.chainId,
      status: { state: row.status, data: row.hash === undefined ? undefined : { hash: row.hash } },
    })),
    state:
      fundingUnknown && savedState === "released"
        ? activity.bundleUuid
          ? "active"
          : "publishing"
        : savedState,
    releaseReason: activity.relayrSafeReleaseReason,
    createdAt: activity.createdAt,
    context: { activity } satisfies SessionContext,
  };
}

export function safeRelayrActivity(session: SafeRelayrSession): TransactionActivity | undefined {
  return refreshTransactionActivities().find(
    (activity) => (activity.relayrSafeSessionId ?? activity.id) === session.id,
  );
}

export function safeRelayrQuote(session: SafeRelayrSession): RelayrPostBundleResponse {
  if (!session.quote) throw new Error("The saved Safe quote is unavailable.");
  return {
    bundle_uuid: session.quote.bundle_uuid,
    payment_info: session.quote.payment_info.map((payment) => ({
      ...payment,
      token: payment.token ?? RELAYR_NATIVE_TOKEN,
    })) as ChainPayment[],
  };
}

export function safeRelayrExecution(request: ReviewedRelayrRequest): SafeRelayrExecution {
  if (!request.expectedSafeExecution) throw new Error("The reviewed Safe identity is missing.");
  const execution: SafeRelayrExecution = {
    entry: {
      chain: request.chainId,
      target: request.data.to,
      data: request.data.data,
      value: request.data.value.toString(),
    },
    ...request.expectedSafeExecution,
  };
  execution.context = {
    review: request.review,
    recoveryScope: request.recoveryScope,
    expected: {
      chainId: request.chainId,
      target: request.data.to,
      data: request.data.data,
      value: request.data.value.toString(),
      gas: gasWithHeadroom(request.data.gas + 100_000n).toString(),
      transactionUuid: "",
      expectedSafeExecution: request.expectedSafeExecution,
      metadataSource: request.metadataSource,
      expectedDeployment: request.expectedDeployment,
      rejectEvents: request.rejectEvents,
      reservedReceipt: request.reservedReceipt,
      expectedPayout: request.expectedPayout,
      expectedRouterPending: request.expectedRouterPending,
      preconditions: [...(request.preconditions ?? []), ...safeRelayrPreconditions(execution)],
    },
  } satisfies ExecutionContext;
  return execution;
}

/** Translate storage, review and wallet effects. All Safe session decisions live in the SDK. */
export function safeRelayrController(
  config: Config,
  /** Whether this controller may pay a quote from the connected wallet. */
  pays = false,
  onProgress?: (progress: SafeRelayrProgress) => void,
) {
  const clientFor = (chainId: number) => getPublicClient(config, { chainId: chainId as JBChainId });
  const requireAccount = (account: Address, chainId?: number) => {
    requireNoViewAs();
    const current = getAccount(config);
    if (
      current.address?.toLowerCase() !== account.toLowerCase() ||
      (chainId !== undefined && current.chainId !== chainId) ||
      isSafeConnection(config)
    )
      throw new Error("Connected account or chain changed. Review the payment again.");
  };
  return createSafeRelayrController({
    onProgress,
    clientFor,
    currentAccount: () => getAccount(config).address,
    store: {
      async list() {
        requireTransactionActivityPersistence();
        return refreshTransactionActivities().flatMap((activity) => {
          const session = safeRelayrSession(activity);
          return session ? [session] : [];
        });
      },
      async save(session) {
        requireTransactionActivityPersistence();
        const previous =
          safeRelayrActivity(session) ?? (session.context as SessionContext | undefined)?.activity;
        const id = session.bundleUuid ? `relayr:${session.bundleUuid}` : session.id;
        const expected = session.executions.map((execution, index): RelayrExpectedTransaction => ({
          ...(execution.context as ExecutionContext).expected,
          chainId: execution.entry.chain,
          target: execution.entry.target,
          data: execution.entry.data,
          value: execution.entry.value,
          transactionUuid: session.quote?.expectedTransactions[index]?.txUuid ?? "",
          expectedSafeExecution: {
            safe: execution.safe,
            safeTxHash: execution.safeTxHash,
            nonce: execution.nonce,
          },
        }));
        const latest = session.payments.at(-1);
        const fundingObserved = session.fundingObserved || previous?.relayrSafeFundingObserved;
        recordTransactionActivity({
          ...previous,
          id,
          relayrSafeSessionId: session.id,
          relayrSafeState: session.state,
          relayrSafeReleaseReason: session.releaseReason,
          relayrSafeReservationKeys: session.reservationKeys,
          relayrSafeFundingUnknown: session.paymentStatus === "sending",
          relayrSafeFundingObserved: fundingObserved,
          kind: "relayr-bundle",
          title: "Safe execution bundle",
          account: session.account,
          status:
            session.state === "complete"
              ? "success"
              : session.state === "released"
                ? "failed"
                : session.paymentStatus === "sending" || session.paymentStatus === "submitted"
                  ? "submitted"
                  : "pending",
          message:
            session.state === "complete"
              ? "All saved destination transactions confirmed. Refresh the Safe queue."
              : session.state === "released"
                ? session.releaseReason === "safe-nonces-consumed"
                  ? "The saved Safe nonces have all advanced onchain. These executions can no longer run. Refresh the Safe queue."
                  : session.releaseReason === "quote-replaced"
                    ? "This unfunded quote was replaced by a fresh review of the current Safe transactions. Nothing was paid."
                    : session.paymentStatus === "unfunded"
                      ? "This review was canceled before its calls were published. Nothing was paid. Review the executions again to request a quote."
                      : LEGACY_RELEASE_MESSAGE
                : session.paymentStatus === "sending" || session.paymentStatus === "submitted"
                  ? "Funding is being submitted. Do not pay again while the wallet result is uncertain."
                  : session.paymentStatus === "confirmed"
                    ? "Payment confirmed. Destination transactions are pending."
                    : fundingObserved
                      ? SAFE_RELAYR_FUNDING_EXIT_LINE
                      : session.quote
                        ? "The Safe execution quote is ready. Review the current transactions before paying."
                        : "Review the current Safe transactions to request a new quote. No funding payment has been started.",
          createdAt: session.createdAt,
          bundleUuid: session.bundleUuid,
          relayrExpectedTransactions: expected,
          relayrCallKeys: [
            ...new Set([
              ...(previous?.relayrCallKeys ?? []),
              ...session.executions.flatMap((execution) => {
                const scope = (execution.context as ExecutionContext).recoveryScope;
                return [
                  relayrRecoveryScopeKey(
                    session.account,
                    `safe-execution:${safeRelayrReservationKey(execution)}`,
                  ),
                  ...(scope ? [relayrRecoveryScopeKey(session.account, scope)] : []),
                ];
              }),
            ]),
          ],
          chainStates: session.records?.map((record) => ({
            chainId: Number(record.request?.chain ?? record.chain),
            status: record.status?.state ?? "Pending",
            hash: record.status?.data?.hash ?? record.status?.data?.transaction?.hash,
          })),
          relayrQuote: session.quote ? safeRelayrQuote(session) : undefined,
          relayrPaymentStatus:
            session.paymentStatus === "sending" ? "submitted" : session.paymentStatus,
          relayrPayments: session.payments.map((payment) => ({
            hash: payment.hash,
            chainId: payment.chainId,
            target: payment.target,
            data: payment.calldata,
            value: payment.amount,
          })),
          ...(latest
            ? {
                hash: latest.hash,
                chainId: latest.chainId,
                relayrPayment: {
                  target: latest.target,
                  data: latest.calldata,
                  value: latest.amount,
                },
              }
            : {}),
          manualVerificationRequired:
            session.state === "complete" ? false : previous?.manualVerificationRequired,
        });
        requireTransactionActivityPersistence();
        if (previous && previous.id !== id) dismissTransactionActivity(previous.id);
      },
      async withLock(account, run) {
        const key = "safe-relayr";
        if (authorizing.has(key)) throw new Error("Another Safe action is already in progress.");
        authorizing.add(key);
        try {
          const locks = browserLocks();
          return (await locks.request(
            `revnet:safe-relayr-lifecycle`,
            { ifAvailable: true },
            (lock) => {
              if (!lock)
                throw new Error(
                  "Another browser tab is preparing authorizations for this account.",
                );
              return locks.request(
                `revnet:relayr-authorizations:${account.toLowerCase()}`,
                { ifAvailable: true },
                (accountLock) => {
                  if (!accountLock)
                    throw new Error("Another authorization is being prepared for this account.");
                  // Core checks both before each save, signature and wallet request.
                  return run([lock, accountLock]);
                },
              );
            },
          )) as Awaited<ReturnType<typeof run>>;
        } finally {
          authorizing.delete(key);
        }
      },
    },
    async revalidate(execution, account) {
      requireAccount(account);
      const client = clientFor(execution.entry.chain);
      const expected = (execution.context as ExecutionContext).expected;
      if (!client || !expected.gas)
        throw new Error(
          "The signed destination call cannot be revalidated. Do not pay this quote.",
        );
      if (expected.metadataSource)
        await verifyMetadataSource(client, expected.metadataSource, account);
      await verifyCallPreconditions(client, [
        ...(expected.preconditions ?? []),
        ...safeRelayrPreconditions(execution),
      ]);
      const result = await simulateStateChangingTransaction(client, {
        // Relayr executes from its own account. An owner's connected address
        // can incorrectly satisfy a v=1 approved-hash signature during eth_call.
        from: zeroAddress,
        to: execution.entry.target,
        data: execution.entry.data,
        value: BigInt(execution.entry.value),
        gas: BigInt(expected.gas),
        maxReturnBytes: 32,
      });
      if (
        decodeFunctionResult({
          abi: SAFE_EXEC_ABI,
          functionName: "execTransaction",
          data: result,
        }) !== true
      )
        throw new Error("The Safe execution simulation did not succeed.");
    },
    async afterVerified(execution, verified) {
      const client = clientFor(execution.entry.chain);
      if (!client) throw new Error("The destination RPC is unavailable.");
      const expected = (execution.context as ExecutionContext).expected;
      await verifyActionReceipt(
        client,
        verified.receipt,
        expected.target,
        expected.expectedDeployment,
        expected.rejectEvents,
        expected.reservedReceipt,
        expected.expectedPayout,
        expected.expectedRouterPending,
      );
    },
    // Core reviews the frozen executions and the selected payment; only a requested payment pays.
    review: async (...args) =>
      (await loadEngine()).safeRelayrWalletDeps(reviewedSendDeps(config)).review(...args),
    sendPayment: async (input) => {
      if (!pays) throw new Error("A wallet payment must be explicitly requested.");
      requireAccount(input.session.account);
      // The payment is refused at the wallet for View-as or another wallet connection.
      const deps = reviewedSendDeps(config);
      const adapter = reviewedWalletAdapter(
        config,
        input.session.account,
        getAccount(config).connector,
      );
      return (await loadEngine()).safeRelayrWalletDeps({ ...deps, adapter }).sendPayment(input);
    },
  });
}
