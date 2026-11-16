import { TransactionReceiptNotFoundError, type Hex, type PublicClient } from "viem";

class TransactionReceiptUnavailableError extends Error {
  readonly name = "TransactionReceiptUnavailableError";
  /** The node's last read answered that it holds no receipt for the hash, not that it failed. */
  readonly noReceipt: boolean;

  constructor(
    readonly hash: Hex,
    readonly chainId?: number,
    options?: ErrorOptions & { noReceipt?: boolean },
  ) {
    super(
      `Transaction ${hash} was submitted${chainId ? ` on chain ${chainId}` : ""}, but confirmation tracking is temporarily unavailable. Check it and do not submit it again yet.`,
      options,
    );
    this.noReceipt = options?.noReceipt === true;
  }
}

/** How long a receipt is watched for before confirmation counts as unavailable. */
const RECEIPT_WAIT_TIMEOUT_MS = 120_000;

/** Keep tracking a broadcast transaction when a load-balanced RPC drops the
 * subscription-style receipt watch. Successful writes must not leave the UI
 * stuck merely because the first backend queried was behind. */
export async function waitForReceiptWithRetry(
  client: PublicClient,
  hash: Hex,
  options: { attempts?: number; intervalMs?: number } = {},
) {
  try {
    return await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_WAIT_TIMEOUT_MS });
  } catch (cause) {
    const attempts = Math.max(1, options.attempts ?? 90);
    const intervalMs = Math.max(0, options.intervalMs ?? 2_000);
    let noReceipt = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await client.getTransactionReceipt({ hash });
      } catch (error) {
        noReceipt = error instanceof TransactionReceiptNotFoundError;
        if (attempt + 1 < attempts) {
          await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
        }
      }
    }
    throw new TransactionReceiptUnavailableError(hash, client.chain?.id, {
      cause,
      noReceipt,
    });
  }
}
