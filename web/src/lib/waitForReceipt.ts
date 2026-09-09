import type { Hex, PublicClient } from "viem";

export class TransactionReceiptUnavailableError extends Error {
  readonly name = "TransactionReceiptUnavailableError";

  constructor(
    readonly hash: Hex,
    readonly chainId?: number,
    options?: ErrorOptions,
  ) {
    super(
      `Transaction ${hash} was submitted${chainId ? ` on chain ${chainId}` : ""}, but confirmation tracking is temporarily unavailable. Check it and do not submit it again yet.`,
      options,
    );
  }
}

export function isTransactionReceiptUnavailableError(
  error: unknown,
): error is TransactionReceiptUnavailableError {
  return error instanceof TransactionReceiptUnavailableError;
}

/** Keep tracking a broadcast transaction when a load-balanced RPC drops the
 * subscription-style receipt watch. Successful writes must not leave the UI
 * stuck merely because the first backend queried was behind. */
export async function waitForReceiptWithRetry(
  client: PublicClient,
  hash: Hex,
  options: { attempts?: number; intervalMs?: number } = {},
) {
  try {
    return await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  } catch (cause) {
    const attempts = Math.max(1, options.attempts ?? 90);
    const intervalMs = Math.max(0, options.intervalMs ?? 2_000);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await client.getTransactionReceipt({ hash });
      } catch {
        if (attempt + 1 < attempts) {
          await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
        }
      }
    }
    throw new TransactionReceiptUnavailableError(hash, client.chain?.id, {
      cause,
    });
  }
}
