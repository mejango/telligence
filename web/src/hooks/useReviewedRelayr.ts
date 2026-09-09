"use client";

import { gasWithHeadroom } from "@/lib/gas";
import {
  requireRawPayerCall,
  verifyActionReceipt,
  verifyCallPreconditions,
  type CallPrecondition,
  type ExpectedPayerDeployment,
  type RejectedReceiptEvent,
  type ReservedReceiptGuard,
} from "@/lib/multichain-guards";
import type {
  ChainPayment,
  JBChainId,
  RelayrGetBundleResponse,
  RelayrPostBundleResponse,
} from "@/lib/nana/types";
import type { ExpectedPayoutReceipt } from "@/lib/payout-receipts";
import { verifyMetadataSource, type MetadataSourceGuard } from "@/lib/project-metadata-write";
import { areRelayrChainsCompatible, isRelayrSupportedChain } from "@/lib/relayr-chains";
import {
  dismissTransactionActivity,
  recordTransactionActivity,
  refreshTransactionActivities,
  requireTransactionActivityPersistence,
  transactionActivitySnapshot,
  updateTransactionActivity,
  type RelayrExpectedTransaction,
} from "@/lib/transaction-activity";
import { requireTransactionReview } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { erc2771ForwarderAbi, jbContractAddress, type JBVersion } from "@bananapus/nana-sdk-core";
import { useCallback, useEffect, useState } from "react";
import {
  encodeFunctionData,
  isAddress,
  keccak256,
  maxUint256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { useAccount, useConfig, useSendTransaction, useSignTypedData, useSwitchChain } from "wagmi";
import { getAccount, getPublicClient, waitForTransactionReceipt } from "wagmi/actions";

const RELAYR_API = "https://api.relayr.ba5ed.com";
const RELAYR_PAYMENT_ADDRESS = "0x1c05f7841379d4393574c0ffa17908ec40ffd97d";
const RELAYR_PAYMENT_CODE_HASH =
  "0x6006b5acadb4cd60aa5c00cb844c34563e182dff83d4f4ff4fde226f7df16fa6";
const RELAYR_NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRUSTED_FORWARDER_ABI = [
  {
    type: "function",
    name: "isTrustedForwarder",
    stateMutability: "view",
    inputs: [{ name: "forwarder", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

export type ReviewedRelayrRequest = {
  chainId: JBChainId;
  version?: JBVersion;
  /** Groups a non-idempotent workflow whose retries may change calldata. */
  recoveryScope?: string;
  metadataSource?: MetadataSourceGuard;
  relayrMode?: "raw" | "forwarded";
  preconditions?: CallPrecondition[];
  expectedDeployment?: ExpectedPayerDeployment;
  rejectEvents?: RejectedReceiptEvent[];
  reservedReceipt?: ReservedReceiptGuard;
  expectedPayout?: ExpectedPayoutReceipt;
  data: {
    from: Address;
    to: Address;
    value: bigint;
    gas: bigint;
    data: Hex;
  };
  review?: {
    abi?: Abi;
    functionName?: string;
    args?: readonly unknown[];
    label?: string;
    contractName?: string;
  };
};

type RememberedQuote = {
  bundleUuid: string;
  account: Address;
  callKey: string;
  callKeys: string[];
  chainIds: number[];
  payments: ChainPayment[];
  expectedTransactions: RelayrExpectedTransaction[];
};

const quotes = new Map<string, RememberedQuote>();
const bundleInflight = new Map<string, Promise<RelayrGetBundleResponse>>();
const paymentInflight = new Set<string>();
const fundedBundles = new Set<string>();
const bundleListeners = new Map<string, Set<(bundle: RelayrGetBundleResponse) => void>>();
const authorizingAccounts = new Set<string>();

async function withAuthorizationLock<T>(account: Address, action: () => Promise<T>): Promise<T> {
  const key = account.toLowerCase();
  if (authorizingAccounts.has(key))
    throw new Error("Another Relayr authorization is being prepared for this account.");
  authorizingAccounts.add(key);
  try {
    return await (typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(
          `revnet:relayr-authorizations:${key}`,
          { ifAvailable: true },
          (lock) => {
            if (!lock)
              throw new Error(
                "Another browser tab is preparing Relayr authorizations for this account.",
              );
            return action();
          },
        )
      : action());
  } finally {
    authorizingAccounts.delete(key);
  }
}

function paymentKey(payment: ChainPayment): string {
  return `${payment.chain}:${payment.target.toLowerCase()}:${payment.amount}:${payment.calldata.toLowerCase()}:${payment.token.toLowerCase()}:${payment.payment_deadline}`;
}

function rememberQuote(
  quote: RelayrPostBundleResponse,
  account: Address,
  callKey: string,
  callKeys: string[],
  expectedTransactions: RelayrExpectedTransaction[],
): void {
  const remembered = {
    bundleUuid: quote.bundle_uuid,
    account,
    callKey,
    callKeys,
    chainIds: expectedTransactions.map((transaction) => transaction.chainId),
    payments: quote.payment_info.map((payment) => ({ ...payment })),
    expectedTransactions,
  };
  quote.payment_info.forEach((payment) => quotes.set(paymentKey(payment), remembered));
}

function requestKey(account: Address, requests: ReviewedRelayrRequest[]): string {
  const calls = requests
    .map(
      (request) =>
        `${request.chainId}:${request.version ?? 6}:${request.data.to.toLowerCase()}:${request.data.value}:${request.data.data.toLowerCase()}`,
    )
    .sort();
  return `${account.toLowerCase()}:relayr:${keccak256(stringToHex(calls.join("|")))}`;
}

function scopeKey(account: Address, scope: string): string {
  return `${account.toLowerCase()}:relayr-scope:${scope}`;
}

/** A changed payload or direct route must not bypass a published operation. */
export function requireRelayrRecoveryScopeAvailable(account: Address, scope: string): void {
  requireTransactionActivityPersistence();
  const existing = refreshTransactionActivities().find(
    (activity) =>
      activity.relayrCallKeys?.includes(scopeKey(account, scope)) &&
      (activity.status !== "success" || activity.manualVerificationRequired),
  );
  if (existing)
    throw new Error(
      scope === "revnet-launch"
        ? "A previous Relayr launch still requires reconciliation. Check its existing bundle in account activity before requesting another launch; do not sign or pay again."
        : "A previous Relayr update for this destination still requires reconciliation. Check its existing bundle in account activity before submitting another update; do not sign or pay again.",
    );
}

function requireUnfunded(
  quote: Pick<RememberedQuote, "bundleUuid" | "callKey" | "callKeys">,
): void {
  requireTransactionActivityPersistence();
  if (fundedBundles.has(quote.bundleUuid))
    throw new Error(
      "This Relayr action already has a submitted payment. Do not pay again; check the existing bundle.",
    );
  const existing = refreshTransactionActivities().find(
    (activity) =>
      (activity.bundleUuid === quote.bundleUuid ||
        ((activity.callKey === quote.callKey ||
          activity.relayrCallKeys?.some((key) => quote.callKeys.includes(key))) &&
          activity.status !== "success")) &&
      !(activity.bundleUuid === quote.bundleUuid && activity.relayrPaymentStatus === "unfunded") &&
      !(activity.bundleUuid === quote.bundleUuid && activity.relayrPaymentStatus === "reverted"),
  );
  if (existing)
    throw new Error(
      `This Relayr action already has ${existing.relayrPaymentStatus === "unfunded" ? "published authorizations" : "a submitted payment"}${existing.hash ? ` (${existing.hash})` : existing.relayrPaymentStatus === "unfunded" ? " awaiting reconciliation" : " with an uncertain wallet result"}. Do not authorize or pay again; check the existing bundle.`,
    );
}

function paymentDetails(payment: ChainPayment, bundleUuid: string, destinationChains: number[]) {
  if (!isRelayrSupportedChain(payment.chain))
    throw new Error("Relayr returned an unsupported payment chain.");
  if (!areRelayrChainsCompatible([...destinationChains, payment.chain]))
    throw new Error(
      "Relayr funding must use the same mainnet or testnet family as its destinations.",
    );
  if (!isAddress(payment.target) || payment.target.toLowerCase() !== RELAYR_PAYMENT_ADDRESS)
    throw new Error("Relayr returned an unrecognized payment contract.");
  if (payment.token?.toLowerCase() !== RELAYR_NATIVE_TOKEN)
    throw new Error("Relayr returned an unsupported payment token.");
  let value: bigint;
  try {
    value = BigInt(payment.amount);
  } catch {
    throw new Error("Relayr returned an invalid payment amount.");
  }
  if (value < 0n) throw new Error("Relayr returned an invalid payment amount.");
  const data = payment.calldata.toLowerCase();
  if (
    !UUID_PATTERN.test(bundleUuid) ||
    !/^0x[0-9a-f]{136}$/.test(data) ||
    data.slice(0, 10) !== "0x103903a7"
  )
    throw new Error("Relayr returned invalid payment calldata.");
  if (data.slice(10, 74) !== `${bundleUuid.replaceAll("-", "").toLowerCase()}${"0".repeat(32)}`)
    throw new Error("Relayr payment calldata does not match this bundle.");
  const deadline = /^\d+$/.test(payment.payment_deadline)
    ? Number(payment.payment_deadline)
    : Math.floor(Date.parse(payment.payment_deadline) / 1_000);
  if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1_000) + 15)
    throw new Error("This Relayr quote expired. Review the action again for a new quote.");
  const encodedDeadline = BigInt(`0x${data.slice(74)}`);
  if (encodedDeadline > 0xffffffffffn || encodedDeadline !== BigInt(deadline))
    throw new Error("Relayr payment calldata does not match the quote deadline.");
  return { value, deadline };
}

function quoteForDestinationChains(
  quote: RelayrPostBundleResponse,
  destinationChains: number[],
): RelayrPostBundleResponse {
  const payments = quote.payment_info.filter((payment) =>
    areRelayrChainsCompatible([...destinationChains, payment.chain]),
  );
  if (!payments.length)
    throw new Error(
      "Relayr returned no funding option for the selected mainnet or testnet family.",
    );
  payments.forEach((payment) => paymentDetails(payment, quote.bundle_uuid, destinationChains));
  // Recovery quotes must not share nested payment objects with caller-owned
  // responses. A later UI update cannot rewrite the already published fee.
  return structuredClone({ ...quote, payment_info: payments });
}

class RelayrVerificationError extends Error {}

function expectedBundleTransactions(bundleUuid: string): RelayrExpectedTransaction[] {
  const expected = transactionActivitySnapshot().find(
    (activity) => activity.bundleUuid === bundleUuid,
  )?.relayrExpectedTransactions;
  if (!expected?.length || new Set(expected.map((item) => item.chainId)).size !== expected.length)
    throw new RelayrVerificationError(
      "The signed destination calls for this bundle are unavailable. Its execution cannot be verified; do not pay again.",
    );
  return expected;
}

function verifyBundleIdentity(
  bundleUuid: string,
  bundle: RelayrGetBundleResponse,
  expected: RelayrExpectedTransaction[],
): void {
  if (
    bundle.bundle_uuid !== bundleUuid ||
    !Array.isArray(bundle.transactions) ||
    bundle.transactions.length !== expected.length
  )
    throw new RelayrVerificationError(
      "Relayr's response does not match the signed bundle and destination count. Do not pay again.",
    );
  const seen = new Set<number>();
  for (const transaction of bundle.transactions) {
    const request = transaction.request;
    const identity = expected.find((item) => item.chainId === request?.chain);
    let value: bigint | undefined;
    try {
      value = BigInt(request?.value);
    } catch {
      /* Invalid API data fails identity verification below. */
    }
    if (
      !identity ||
      seen.has(request.chain) ||
      transaction.tx_uuid !== identity.transactionUuid ||
      request.target?.toLowerCase() !== identity.target.toLowerCase() ||
      request.data?.toLowerCase() !== identity.data.toLowerCase() ||
      value !== BigInt(identity.value)
    )
      throw new RelayrVerificationError(
        "Relayr's destination call does not match the signed request. Do not pay again.",
      );
    seen.add(request.chain);
  }
}

async function verifyDestinationReceipts(
  bundle: RelayrGetBundleResponse,
  expected: RelayrExpectedTransaction[],
): Promise<void> {
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  for (const transaction of bundle.transactions) {
    const data = transaction.status?.data as
      { hash?: Hex; transaction?: { hash?: Hex } } | undefined;
    const hash = data?.hash ?? data?.transaction?.hash;
    if (!hash || !/^0x[0-9a-f]{64}$/i.test(hash))
      throw new RelayrVerificationError(
        "Relayr reported completion without a destination transaction hash. Do not pay again.",
      );
    const identity = expected.find((item) => item.chainId === transaction.request.chain)!;
    const client = getPublicClient(wagmiConfig, { chainId: identity.chainId as JBChainId });
    if (!client) throw new Error("The destination RPC is unavailable.");
    const [onchain, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
    if (
      onchain.hash.toLowerCase() !== hash.toLowerCase() ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      onchain.to?.toLowerCase() !== identity.target.toLowerCase() ||
      onchain.input.toLowerCase() !== identity.data.toLowerCase() ||
      onchain.value !== BigInt(identity.value) ||
      receipt.to?.toLowerCase() !== identity.target.toLowerCase() ||
      onchain.blockHash !== receipt.blockHash ||
      onchain.blockNumber !== receipt.blockNumber
    )
      throw new RelayrVerificationError(
        "The onchain destination transaction does not match the signed request. Do not pay again.",
      );
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash)
      throw new Error("Destination receipt is not in the current canonical chain.");
    if (receipt.status !== "success")
      throw new RelayrVerificationError(
        "A destination transaction reverted onchain. Review the original bundle before attempting recovery.",
      );
    try {
      await verifyActionReceipt(
        client,
        receipt,
        identity.target,
        identity.expectedDeployment,
        identity.rejectEvents,
        identity.reservedReceipt,
        identity.expectedPayout,
      );
    } catch (cause) {
      throw new RelayrVerificationError(
        cause instanceof Error
          ? cause.message
          : "The destination action result could not be verified.",
      );
    }
  }
}

async function verifyPaymentReceipt(bundleUuid: string): Promise<void> {
  const activity = transactionActivitySnapshot().find((item) => item.bundleUuid === bundleUuid);
  if (!activity?.hash || !activity.relayrPayment || !activity.account || !activity.chainId)
    throw new RelayrVerificationError(
      "The original funding transaction cannot be verified. Do not pay again; inspect the existing bundle and wallet activity.",
    );
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  const client = getPublicClient(wagmiConfig, { chainId: activity.chainId as JBChainId });
  if (!client) throw new Error("The funding RPC is unavailable.");
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash: activity.hash }),
    client.getTransactionReceipt({ hash: activity.hash }),
  ]);
  const expected = activity.relayrPayment;
  if (
    transaction.hash.toLowerCase() !== activity.hash.toLowerCase() ||
    receipt.transactionHash.toLowerCase() !== activity.hash.toLowerCase() ||
    transaction.from.toLowerCase() !== activity.account.toLowerCase() ||
    transaction.to?.toLowerCase() !== expected.target.toLowerCase() ||
    receipt.to?.toLowerCase() !== expected.target.toLowerCase() ||
    transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
    transaction.value !== BigInt(expected.value) ||
    transaction.blockHash !== receipt.blockHash ||
    transaction.blockNumber !== receipt.blockNumber
  )
    throw new RelayrVerificationError(
      "The funding receipt does not match the reviewed payment. Do not pay again.",
    );
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash)
    throw new Error("Funding receipt is not in the current canonical chain.");
  if (receipt.status !== "success") {
    fundedBundles.delete(bundleUuid);
    updateTransactionActivity(activity.id, {
      status: "failed",
      relayrPaymentStatus: "reverted",
      manualVerificationRequired: true,
      message:
        "The original Relayr funding transaction reverted onchain. Its destination authorizations remain reserved; retry only the exact saved quote.",
    });
    throw new RelayrVerificationError("The Relayr funding transaction reverted onchain.");
  }
  updateTransactionActivity(activity.id, { relayrPaymentStatus: "confirmed" });
}

function stateIsSuccess(state?: string): boolean {
  return state === "Success" || state === "Completed";
}

function stateIsFailed(state?: string): boolean {
  return state === "Failed" || state === "Reverted" || state === "Dropped";
}

function safeConnection(config: ReturnType<typeof useConfig>): boolean {
  const connector = getAccount(config).connector;
  return `${connector?.id ?? ""} ${connector?.name ?? ""}`.toLowerCase().includes("safe");
}

async function fetchBundle(bundleUuid: string): Promise<RelayrGetBundleResponse> {
  const response = await fetch(`${RELAYR_API}/v1/bundle/${bundleUuid}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Relayr bundle check failed (${response.status}).`);
  return response.json();
}

function bundleSummary(bundle: RelayrGetBundleResponse): string {
  return bundle.transactions
    .map((transaction) => {
      const data = transaction.status?.data as
        { hash?: Hex; transaction?: { hash?: Hex } } | undefined;
      const hash = data?.hash ?? data?.transaction?.hash;
      return `Chain ${transaction.request.chain}: ${transaction.status?.state ?? "Pending"}${hash ? ` (${hash})` : ""}`;
    })
    .join(" | ");
}

function bundleChainStates(bundle: RelayrGetBundleResponse) {
  return bundle.transactions.map((transaction) => {
    const data = transaction.status?.data as
      { hash?: Hex; transaction?: { hash?: Hex } } | undefined;
    return {
      chainId: Number(transaction.request.chain),
      status: transaction.status?.state ?? "Pending",
      hash: data?.hash ?? data?.transaction?.hash,
    };
  });
}

export async function waitForRelayrBundle(
  bundleUuid: string,
  onUpdate?: (bundle: RelayrGetBundleResponse) => void,
): Promise<RelayrGetBundleResponse> {
  const listeners =
    bundleListeners.get(bundleUuid) ?? new Set<(bundle: RelayrGetBundleResponse) => void>();
  if (onUpdate) listeners.add(onUpdate);
  bundleListeners.set(bundleUuid, listeners);
  const notify = (bundle: RelayrGetBundleResponse) =>
    listeners.forEach((listener) => listener(bundle));
  const existing = bundleInflight.get(bundleUuid);
  if (existing) return existing;
  const activityId = `relayr:${bundleUuid}`;
  const request = (async () => {
    let last: RelayrGetBundleResponse | null = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        await verifyPaymentReceipt(bundleUuid);
        const expected = expectedBundleTransactions(bundleUuid);
        last = await fetchBundle(bundleUuid);
        verifyBundleIdentity(bundleUuid, last, expected);
        const states = last.transactions.map((transaction) => transaction.status?.state);
        const summary = bundleSummary(last);
        if (states.some(stateIsFailed)) {
          updateTransactionActivity(activityId, {
            status: "failed",
            manualVerificationRequired: true,
            message: `Do not pay again. Relayr reported a failed destination transaction. ${summary}`,
            chainStates: bundleChainStates(last),
          });
          notify(last);
          throw new Error(`Relayr bundle ${bundleUuid} failed. ${summary}`);
        }
        if (states.length > 0 && states.every(stateIsSuccess)) {
          await verifyDestinationReceipts(last, expected);
          updateTransactionActivity(activityId, {
            status: "success",
            manualVerificationRequired: false,
            message: `All ${states.length} destination transactions confirmed. ${summary}`,
            chainStates: bundleChainStates(last),
          });
          notify(last);
          return last;
        }
        updateTransactionActivity(activityId, {
          status: "pending",
          message: `Relayr payment confirmed; destination transactions are still executing. ${summary}`,
          chainStates: bundleChainStates(last),
        });
        notify(last);
      } catch (error) {
        if (error instanceof RelayrVerificationError) {
          const reverted =
            transactionActivitySnapshot().find((item) => item.id === activityId)
              ?.relayrPaymentStatus === "reverted";
          if (!reverted)
            updateTransactionActivity(activityId, {
              status: "failed",
              manualVerificationRequired: true,
              message: error.message,
            });
          throw error;
        }
        if (error instanceof Error && /bundle .* failed/.test(error.message)) throw error;
        updateTransactionActivity(activityId, {
          status: "pending",
          message:
            "Relayr confirmation is temporarily unavailable. Do not pay again; check this bundle again.",
        });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error(
      `Relayr bundle ${bundleUuid} is still pending after the status timeout. Do not pay again; resume checking this bundle.`,
    );
  })();
  bundleInflight.set(bundleUuid, request);
  void request
    .finally(() => {
      bundleInflight.delete(bundleUuid);
      bundleListeners.delete(bundleUuid);
    })
    .catch(() => undefined);
  return request;
}

export function resumePendingRelayrBundles(): void {
  transactionActivitySnapshot()
    .filter(
      (activity) =>
        activity.kind === "relayr-bundle" &&
        activity.relayrPaymentStatus !== "unfunded" &&
        activity.bundleUuid &&
        (activity.status === "submitted" || activity.status === "pending"),
    )
    .forEach((activity) => void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined));
}

export function useGetRelayrTxQuote() {
  const config = useConfig();
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [data, setData] = useState<RelayrPostBundleResponse>();
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);

  const reset = useCallback(() => {
    setData(undefined);
    setError(null);
    setIsPending(false);
  }, []);

  const getRelayrTxQuote = useCallback(
    async (requests: ReviewedRelayrRequest[]) => {
      if (!address) throw new Error("Connect a wallet first.");
      return withAuthorizationLock(address, async () => {
        requireNoViewAs();
        requests = requests.map((request) => ({ ...request, data: { ...request.data } }));
        if (!address) throw new Error("Connect a wallet first.");
        if (!requests.length) throw new Error("There are no Relayr calls to quote.");
        if (safeConnection(config)) {
          throw new Error(
            "A Safe cannot authorize these ERC-2771 requests as an EOA. Submit each action through the Safe proposal flow instead.",
          );
        }
        const requestChains = new Set<number>();
        for (const request of requests) {
          if (request.data.from.toLowerCase() !== address.toLowerCase()) {
            throw new Error("Relayr request sender does not match the connected account.");
          }
          if (requestChains.has(request.chainId)) {
            throw new Error(
              `Relayr cannot safely sign two requests for account ${address} on chain ${request.chainId} with the same onchain nonce.`,
            );
          }
          if (!isRelayrSupportedChain(request.chainId))
            throw new Error(
              "Relayr is unavailable on this network. Use the direct transaction flow.",
            );
          requestChains.add(request.chainId);
        }
        if (!areRelayrChainsCompatible([...requestChains]))
          throw new Error("Choose only mainnets or only testnets for one Relayr bundle.");
        const callKey = requestKey(address, requests);
        const callKeys = requests.flatMap((request) => [
          requestKey(address, [request]),
          ...(request.recoveryScope ? [scopeKey(address, request.recoveryScope)] : []),
          ...(request.relayrMode === "raw"
            ? []
            : [
                scopeKey(
                  address,
                  `forwarder-nonce:${request.chainId}:${jbContractAddress[request.version ?? 6].ERC2771Forwarder[request.chainId]?.toLowerCase()}`,
                ),
              ]),
        ]);
        const existingQuote = refreshTransactionActivities().find(
          (activity) =>
            activity.callKey === callKey &&
            (activity.relayrPaymentStatus === "unfunded" ||
              activity.relayrPaymentStatus === "reverted") &&
            activity.relayrQuote,
        );
        if (existingQuote?.relayrQuote && existingQuote.relayrExpectedTransactions) {
          const quote = quoteForDestinationChains(existingQuote.relayrQuote, [...requestChains]);
          updateTransactionActivity(existingQuote.id, {
            relayrCallKeys: Array.from(
              new Set([...(existingQuote.relayrCallKeys ?? []), ...callKeys]),
            ),
          });
          requireTransactionActivityPersistence();
          rememberQuote(
            quote,
            address,
            callKey,
            callKeys,
            existingQuote.relayrExpectedTransactions,
          );
          setData(quote);
          setError(null);
          return quote;
        }
        requireUnfunded({ bundleUuid: "", callKey, callKeys });
        // Older saved quotes predate the nonce scope. Their exact outer targets
        // still prove which signer/chain forwarder remains reserved.
        const unresolvedNonce = refreshTransactionActivities().find(
          (activity) =>
            activity.account?.toLowerCase() === address.toLowerCase() &&
            (activity.status !== "success" || activity.manualVerificationRequired) &&
            activity.relayrExpectedTransactions?.some((expected) =>
              requests.some(
                (request) =>
                  request.relayrMode !== "raw" &&
                  request.chainId === expected.chainId &&
                  expected.target.toLowerCase() ===
                    jbContractAddress[request.version ?? 6].ERC2771Forwarder[
                      request.chainId
                    ]?.toLowerCase(),
              ),
            ),
        );
        if (unresolvedNonce)
          throw new Error(
            "This signer and destination forwarder already has published authorizations awaiting reconciliation. Complete the original bundle before authorizing a different operation.",
          );
        setIsPending(true);
        setError(null);
        try {
          let authorizationExpiresAt = Infinity;
          const executionGas: string[] = [];
          const transactions: Array<{
            chain: JBChainId;
            data: Hex;
            target: Address;
            value: string;
            version?: JBVersion;
          }> = [];
          for (const request of requests) {
            await switchChainAsync({ chainId: request.chainId });
            const current = getAccount(config);
            if (!current.address || current.address.toLowerCase() !== address.toLowerCase()) {
              throw new Error("Connected account changed. Review the Relayr authorization again.");
            }
            if (current.chainId !== request.chainId) {
              throw new Error(
                "Connected chain did not switch. Review the Relayr authorization again.",
              );
            }
            const version = request.version ?? 6;
            const forwarder = jbContractAddress[version].ERC2771Forwarder[request.chainId];
            const client = getPublicClient(config, { chainId: request.chainId });
            if (!client || !forwarder)
              throw new Error(`Relayr is unavailable on chain ${request.chainId}.`);
            if (request.metadataSource)
              await verifyMetadataSource(client, request.metadataSource, address);
            await verifyCallPreconditions(client, request.preconditions);
            if (request.relayrMode === "raw") {
              requireRawPayerCall(
                request.data.to,
                request.data.data,
                request.data.value,
                request.expectedDeployment,
              );
              await requireTransactionReview({
                kind: "transaction",
                title: `Review payer deployment on chain ${request.chainId}`,
                description:
                  "Relayr deploys this payer from its own sending account. The exact owner, project, beneficiary and settings below are independent of that sender. A separate payment funds the selected deployments.",
                confirmLabel: "Agree & request Relayr quote",
                calls: [
                  {
                    chainId: request.chainId,
                    from: address,
                    to: request.data.to,
                    value: request.data.value,
                    data: request.data.data,
                    ...request.review,
                  },
                ],
              });
              if (getAccount(config).address?.toLowerCase() !== address.toLowerCase())
                throw new Error("Connected account changed. Review the deployment again.");
              await verifyCallPreconditions(client, request.preconditions);
              await client.call({
                account: address,
                to: request.data.to,
                data: request.data.data,
                value: request.data.value,
              });
              executionGas.push(gasWithHeadroom(request.data.gas + 100_000n).toString());
              transactions.push({
                chain: request.chainId,
                target: request.data.to,
                data: request.data.data,
                value: request.data.value.toString(),
                version: request.version,
              });
              continue;
            }
            const trusted = await client.readContract({
              address: request.data.to,
              abi: TRUSTED_FORWARDER_ABI,
              functionName: "isTrustedForwarder",
              args: [forwarder],
            });
            if (trusted !== true)
              throw new Error(
                "The destination contract does not trust this forwarder. Use a direct transaction.",
              );
            await client.call({
              account: forwarder,
              stateOverride: [{ address: forwarder, balance: maxUint256 }],
              to: request.data.to,
              value: request.data.value,
              data: `${request.data.data}${address.slice(2).toLowerCase()}` as Hex,
            });
            const measuredGas = gasWithHeadroom(
              await client.estimateGas({
                account: forwarder,
                stateOverride: [{ address: forwarder, balance: maxUint256 }],
                to: request.data.to,
                value: request.data.value,
                data: `${request.data.data}${address.slice(2).toLowerCase()}` as Hex,
              }),
            );
            const nonce = await client.readContract({
              address: forwarder,
              abi: erc2771ForwarderAbi,
              functionName: "nonces",
              args: [address],
            });
            const fields = await client.readContract({
              address: forwarder,
              abi: erc2771ForwarderAbi,
              functionName: "eip712Domain",
            });
            if (
              fields[0] !== "0x0f" ||
              fields[3] !== BigInt(request.chainId) ||
              fields[4].toLowerCase() !== forwarder.toLowerCase() ||
              fields[6].length
            )
              throw new Error("The forwarder domain does not match this chain and deployment.");
            const deadline = Math.floor(Date.now() / 1_000) + 47 * 60 * 60;
            authorizationExpiresAt = Math.min(authorizationExpiresAt, deadline * 1_000);
            const domain = {
              name: fields[1],
              version: fields[2],
              chainId: request.chainId,
              verifyingContract: forwarder,
            } as const;
            const message = {
              ...request.data,
              gas: measuredGas > request.data.gas ? measuredGas : request.data.gas,
              nonce,
              deadline,
            };
            await requireTransactionReview({
              kind: "authorization",
              title: `Review Relayr authorization on chain ${request.chainId}`,
              description:
                "This EIP-712 signature authorizes Relayr's forwarder to submit the exact destination call below. The separate Relayr payment will be reviewed later.",
              confirmLabel: "Agree & sign Relayr request",
              authorization: {
                type: "EIP-712 ForwardRequest",
                domain,
                primaryType: "ForwardRequest",
                types: FORWARD_REQUEST_TYPES,
                message,
              },
              calls: [
                {
                  chainId: request.chainId,
                  from: address,
                  to: request.data.to,
                  value: request.data.value,
                  data: request.data.data,
                  abi: request.review?.abi,
                  functionName: request.review?.functionName,
                  args: request.review?.args,
                  label: request.review?.label,
                  contractName: request.review?.contractName,
                },
              ],
            });
            const live = getAccount(config);
            if (
              !live.address ||
              live.address.toLowerCase() !== address.toLowerCase() ||
              live.chainId !== request.chainId
            ) {
              throw new Error("Connected account changed. Review the Relayr authorization again.");
            }
            if (request.metadataSource)
              await verifyMetadataSource(client, request.metadataSource, address);
            await verifyCallPreconditions(client, request.preconditions);
            const signature = await signTypedDataAsync({
              domain,
              types: FORWARD_REQUEST_TYPES,
              primaryType: "ForwardRequest",
              message,
            });
            const afterSignature = getAccount(config);
            if (
              !afterSignature.address ||
              afterSignature.address.toLowerCase() !== address.toLowerCase() ||
              afterSignature.chainId !== request.chainId
            ) {
              throw new Error(
                "Connected account changed while signing. Review the Relayr authorization again.",
              );
            }
            executionGas.push(gasWithHeadroom(message.gas + 100_000n).toString());
            const signedData = encodeFunctionData({
              abi: erc2771ForwarderAbi,
              functionName: "execute",
              args: [{ ...message, signature }],
            });
            transactions.push({
              chain: request.chainId,
              target: forwarder,
              data: signedData,
              value: request.data.value.toString(),
              version: request.version,
            });
          }
          // A response can be lost after Relayr receives executable signatures. Persist
          // the intent first so a reload cannot authorize a fresh copy of the same calls.
          requireUnfunded({ bundleUuid: "", callKey, callKeys });
          const publicationId = `relayr-publication:${callKey}`;
          recordTransactionActivity({
            id: publicationId,
            kind: "relayr-bundle",
            title: "Relayr authorization publication",
            status: "pending",
            message:
              "Signed Relayr calls were published. If the quote response is lost, do not authorize the same action again until the existing signed calls have been reconciled onchain.",
            account: address,
            callKey,
            relayrCallKeys: callKeys,
            relayrPaymentStatus: "unfunded",
            relayrAuthorizationExpiresAt: authorizationExpiresAt,
            relayrExpectedTransactions: transactions.map((transaction, index) => ({
              gas: executionGas[index],
              metadataSource: requests[index].metadataSource,
              preconditions: requests[index].preconditions,
              expectedDeployment: requests[index].expectedDeployment,
              rejectEvents: requests[index].rejectEvents,
              reservedReceipt: requests[index].reservedReceipt,
              expectedPayout: requests[index].expectedPayout,
              chainId: transaction.chain,
              target: transaction.target,
              data: transaction.data,
              value: transaction.value,
              transactionUuid: "",
            })),
          });
          requireTransactionActivityPersistence();
          const response = await fetch(`${RELAYR_API}/v1/bundle/prepaid`, {
            method: "POST",
            signal: AbortSignal.timeout(45_000),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions, virtual_nonce_mode: "Disabled" }),
          });
          if (!response.ok) throw new Error(await response.text());
          const receivedQuote = (await response.json()) as RelayrPostBundleResponse;
          if (
            !UUID_PATTERN.test(receivedQuote.bundle_uuid) ||
            !Array.isArray(receivedQuote.payment_info) ||
            !receivedQuote.payment_info.length
          ) {
            throw new Error("Relayr returned an incomplete quote without a payable bundle.");
          }
          const quote = quoteForDestinationChains(receivedQuote, [...requestChains]);
          if (
            !Array.isArray(quote.txn_uuids) ||
            quote.txn_uuids.length !== transactions.length ||
            new Set(quote.txn_uuids).size !== transactions.length ||
            quote.txn_uuids.some((uuid) => typeof uuid !== "string" || !uuid.trim())
          )
            throw new Error(
              "Relayr returned an incomplete quote without the signed transaction identities.",
            );
          const expectedTransactions = transactions.map((transaction, index) => ({
            gas: executionGas[index],
            metadataSource: requests[index].metadataSource,
            preconditions: requests[index].preconditions,
            expectedDeployment: requests[index].expectedDeployment,
            rejectEvents: requests[index].rejectEvents,
            reservedReceipt: requests[index].reservedReceipt,
            expectedPayout: requests[index].expectedPayout,
            chainId: transaction.chain,
            target: transaction.target,
            data: transaction.data,
            value: transaction.value,
            transactionUuid: quote.txn_uuids[index],
          }));
          recordTransactionActivity({
            id: `relayr:${quote.bundle_uuid}`,
            kind: "relayr-bundle",
            title: "Relayr bundle ready for payment",
            status: "pending",
            message:
              "The destination authorizations are signed. Choose a funding chain to pay this existing quote once.",
            account: address,
            callKey,
            relayrCallKeys: callKeys,
            bundleUuid: quote.bundle_uuid,
            relayrPaymentStatus: "unfunded",
            relayrAuthorizationExpiresAt: authorizationExpiresAt,
            relayrExpectedTransactions: expectedTransactions,
            relayrQuote: structuredClone(quote),
          });
          dismissTransactionActivity(publicationId);
          rememberQuote(quote, address, callKey, callKeys, expectedTransactions);

          setData(quote);
          return quote;
        } catch (cause) {
          const next =
            cause instanceof Error ? cause : new Error("Could not request a Relayr quote.");
          setError(next);
          throw next;
        } finally {
          setIsPending(false);
        }
      });
    },
    [address, config, signTypedDataAsync, switchChainAsync],
  );

  return { getRelayrTxQuote, data, reset, error, isPending, isSuccess: !!data };
}

export function useSendRelayrTx() {
  const config = useConfig();
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const transaction = useSendTransaction();

  const sendRelayrTx = useCallback(
    async (offeredPayment: ChainPayment): Promise<Hex> => {
      requireNoViewAs();
      if (!address) throw new Error("Connect a wallet first.");
      if (safeConnection(config))
        throw new Error(
          "Submit each action through the Safe proposal flow instead of paying an EOA Relayr quote.",
        );
      const payment = { ...offeredPayment };
      const remembered = quotes.get(paymentKey(payment));
      if (!remembered || remembered.account.toLowerCase() !== address.toLowerCase())
        throw new Error(
          "This payment does not belong to a reviewed Relayr quote for the connected account. Review the action again.",
        );
      const activityId = `relayr:${remembered.bundleUuid}`;
      const submit = async () => {
        requireUnfunded(remembered);
        const { value } = paymentDetails(payment, remembered.bundleUuid, remembered.chainIds);
        await switchChainAsync({ chainId: payment.chain });
        const requireAccount = () => {
          requireNoViewAs();
          const current = getAccount(config);
          if (
            !current.address ||
            current.address.toLowerCase() !== address.toLowerCase() ||
            current.chainId !== payment.chain ||
            safeConnection(config)
          )
            throw new Error("Connected account or chain changed. Review the Relayr payment again.");
        };
        requireAccount();
        await requireTransactionReview({
          kind: "transaction",
          title: "Review Relayr payment",
          description:
            "This one payment funds the signed calls on every selected chain. Destination transactions confirm separately.",
          confirmLabel: "Agree & pay Relayr",
          calls: [
            {
              chainId: payment.chain,
              from: address,
              to: payment.target,
              value,
              data: payment.calldata,
              label: "Pay Relayr bundle fee",
            },
          ],
        });
        requireAccount();
        const publicClient = getPublicClient(config, { chainId: payment.chain });
        if (!publicClient) throw new Error("Relayr payment network is unavailable.");
        const code = await publicClient.getCode({ address: payment.target });
        if (!code || keccak256(code) !== RELAYR_PAYMENT_CODE_HASH)
          throw new Error("Relayr payment contract code is not recognized.");
        const gas = gasWithHeadroom(
          await publicClient.estimateGas({
            account: address,
            to: payment.target,
            value,
            data: payment.calldata,
          }),
        );
        // Funding may be approved long after signing. Re-run the exact signed
        // forwarder calls against live state so consumed nonces, expired signatures,
        // changed permissions and destination reverts cannot receive a payment.
        for (const expected of remembered.expectedTransactions) {
          const client = getPublicClient(config, { chainId: expected.chainId as JBChainId });
          if (!client || !expected.gas)
            throw new Error(
              "The signed destination call cannot be revalidated. Do not pay this quote.",
            );
          if (expected.metadataSource)
            await verifyMetadataSource(client, expected.metadataSource, address);
          await verifyCallPreconditions(client, expected.preconditions);
          await client.call({
            account: address,
            to: expected.target,
            data: expected.data,
            value: BigInt(expected.value),
            gas: BigInt(expected.gas),
            stateOverride: [{ address, balance: maxUint256 }],
          });
        }
        requireAccount();
        paymentDetails(payment, remembered.bundleUuid, remembered.chainIds);
        requireUnfunded(remembered);
        recordTransactionActivity({
          id: activityId,
          kind: "relayr-bundle",
          title: "Relayr multi-chain bundle",
          status: "submitted",
          message:
            "Relayr funding is being submitted. Do not pay again while the wallet result is uncertain.",
          chainId: payment.chain,
          account: address,
          bundleUuid: remembered.bundleUuid,
          relayrExpectedTransactions: remembered.expectedTransactions,
          relayrPayment: {
            target: payment.target,
            data: payment.calldata,
            value: value.toString(),
          },
          relayrPaymentStatus: "submitted",
          chainStates: remembered.chainIds.map((chainId) => ({ chainId, status: "Pending" })),
          callKey: remembered.callKey,
        });
        requireTransactionActivityPersistence();
        let hash: Hex;
        try {
          hash = await transaction.sendTransactionAsync({
            account: address,
            chainId: payment.chain,
            to: payment.target,
            value,
            data: payment.calldata,
            gas,
          });
        } catch (error) {
          // Only an explicit wallet rejection proves that no transaction was broadcast.
          let cause: unknown = error;
          let rejected = false;
          const seen = new Set<unknown>();
          while (cause && typeof cause === "object" && !seen.has(cause)) {
            seen.add(cause);
            const details = cause as { code?: number; cause?: unknown };
            if (details.code === 4001) rejected = true;
            cause = details.cause;
          }
          if (rejected)
            updateTransactionActivity(activityId, {
              status: "pending",
              relayrPaymentStatus: "unfunded",
              message:
                "The wallet declined payment. The existing signed quote can still be funded once before it expires.",
            });
          else
            updateTransactionActivity(activityId, {
              status: "pending",
              message:
                "The wallet's funding result is uncertain. Do not pay again; inspect wallet activity and this bundle.",
            });
          throw error;
        }
        fundedBundles.add(remembered.bundleUuid);
        updateTransactionActivity(activityId, {
          hash,
          message: "Relayr payment submitted. Do not pay again while its receipt is pending.",
        });
        try {
          await waitForTransactionReceipt(config, { chainId: payment.chain, hash });
          await verifyPaymentReceipt(remembered.bundleUuid);
        } catch (error) {
          if (!(error instanceof RelayrVerificationError))
            updateTransactionActivity(activityId, {
              status: "pending",
              message:
                "Relayr payment was submitted, but confirmation is uncertain. Do not pay again; check this hash and bundle.",
            });
          throw new Error(
            `Relayr payment ${hash} was submitted, but confirmation is uncertain. Do not pay again.`,
            { cause: error },
          );
        }
        updateTransactionActivity(activityId, {
          status: "pending",
          message: "Relayr payment confirmed. Destination transactions are now pending.",
        });
        void waitForRelayrBundle(remembered.bundleUuid).catch(() => undefined);
        return hash;
      };
      if (paymentInflight.has(remembered.callKey))
        throw new Error("This Relayr payment is already in progress. Do not pay again.");
      paymentInflight.add(remembered.callKey);
      try {
        const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
        return await (locks
          ? locks.request(`revnet:relayr:${remembered.callKey}`, submit)
          : submit());
      } finally {
        paymentInflight.delete(remembered.callKey);
      }
    },
    [address, config, switchChainAsync, transaction],
  );

  return {
    sendRelayrTx,
    isPending: transaction.isPending,
    error: transaction.error,
    isSuccess: transaction.isSuccess,
    data: transaction.data,
  };
}

export function useGetRelayrTxBundle() {
  const [uuid, setUuid] = useState<string>();
  const [response, setResponse] = useState<RelayrGetBundleResponse>();
  const [error, setError] = useState<unknown>();
  const [isPolling, setIsPolling] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const startPolling = useCallback((bundleUuid: string) => {
    setResponse(undefined);
    setError(undefined);
    setIsPolling(true);
    setUuid(bundleUuid);
    setPollAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (!uuid) return;
    let active = true;
    setIsPolling(true);
    void waitForRelayrBundle(uuid, (next) => active && setResponse(next))
      .then((next) => active && setResponse(next))
      .catch((cause) => active && setError(cause))
      .finally(() => active && setIsPolling(false));
    return () => {
      active = false;
    };
  }, [uuid, pollAttempt]);

  const states = response?.transactions.map((item) => item.status?.state) ?? [];
  const isComplete = !error && !isPolling && states.length > 0 && states.every(stateIsSuccess);
  const hasFailed = !!error || states.some(stateIsFailed);
  return { startPolling, isComplete, hasFailed, uuid, response, isPolling, error };
}
