"use client";

import {
  SAFE_TX_TYPES,
  safeMessage,
  safeTransactionHash,
  type SafeQueuedTransaction,
} from "@/lib/safe-queue";
import { requireTransactionReview } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { useCallback } from "react";
import { type Address, type Hex } from "viem";
import { useConfig, useSwitchChain } from "wagmi";
import { getAccount, getWalletClient } from "wagmi/actions";

export type ReviewedSafeSignatureRequest = {
  chainId: number;
  safe: Address;
  tx: SafeQueuedTransaction;
  /** Re-authenticate the Safe/owner after review and chain switching. */
  reverify?: (account: Address) => Promise<void>;
};

function exactSafeDigest(
  chainId: number,
  safe: Address,
  tx: SafeQueuedTransaction,
  expected?: Hex,
): Hex {
  const digest = safeTransactionHash(chainId, safe, tx);
  const serviceHash = tx.safeTxHash ?? tx.contractTransactionHash;
  if (serviceHash && serviceHash.toLowerCase() !== digest.toLowerCase()) {
    throw new Error("Safe service transaction data does not match its signed hash.");
  }
  if (expected && expected.toLowerCase() !== digest.toLowerCase()) {
    throw new Error("The Safe transaction changed while the wallet signature was pending.");
  }
  return digest;
}

export function useReviewedSafeSignature() {
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();

  const signSafeTransactionAsync = useCallback(
    async ({ chainId, safe, tx, reverify }: ReviewedSafeSignatureRequest): Promise<Hex> => {
      requireNoViewAs();
      const before = getAccount(config);
      if (!before.address) throw new Error("Connect a wallet first.");

      const digest = exactSafeDigest(chainId, safe, tx);

      await requireTransactionReview({
        kind: "authorization",
        title: "Review Safe transaction signature",
        description:
          "This signature approves the exact queued Safe call. It does not execute until the threshold and nonce requirements are met.",
        confirmLabel: "Agree & sign Safe transaction",
        authorization: {
          type: "EIP-712 SafeTx",
          safe,
          nonce: tx.nonce,
          digest,
          message: safeMessage(tx),
        },
        calls: [
          {
            chainId,
            from: before.address,
            to: tx.to,
            value: BigInt(tx.value ?? 0),
            data: tx.data ?? "0x",
            label: `Safe transaction #${tx.nonce}`,
          },
        ],
      });

      await switchChainAsync({ chainId });
      const after = getAccount(config);
      if (
        !after.address ||
        after.address.toLowerCase() !== before.address.toLowerCase() ||
        after.chainId !== chainId
      ) {
        throw new Error("Connected account or network changed. Review the Safe transaction again.");
      }
      await reverify?.(after.address);
      const reverified = getAccount(config);
      if (
        !reverified.address ||
        reverified.address.toLowerCase() !== after.address.toLowerCase() ||
        reverified.chainId !== chainId
      ) {
        throw new Error("Connected account or network changed. Review the Safe transaction again.");
      }
      const wallet = await getWalletClient(config, { chainId, account: after.address });
      if (
        !wallet.account ||
        wallet.account.address.toLowerCase() !== before.address.toLowerCase()
      ) {
        throw new Error("Connected account changed. Review the Safe transaction again.");
      }
      const signature = await wallet.signTypedData({
        account: wallet.account,
        domain: { chainId, verifyingContract: safe },
        types: SAFE_TX_TYPES,
        primaryType: "SafeTx",
        message: safeMessage(tx),
      });
      const signedAccount = getAccount(config);
      if (
        !signedAccount.address ||
        signedAccount.address.toLowerCase() !== before.address.toLowerCase() ||
        signedAccount.chainId !== chainId
      ) {
        throw new Error("Connected account or network changed. Review the Safe transaction again.");
      }
      // A wallet prompt has no time bound. Re-authenticate the live project
      // Safe after it closes, before the caller can POST this signature to the
      // transaction service, and prove the signed payload stayed exact.
      await reverify?.(signedAccount.address);
      exactSafeDigest(chainId, safe, tx, digest);
      const postverified = getAccount(config);
      if (
        !postverified.address ||
        postverified.address.toLowerCase() !== signedAccount.address.toLowerCase() ||
        postverified.chainId !== chainId
      ) {
        throw new Error("Connected account or network changed. Review the Safe transaction again.");
      }
      return signature;
    },
    [config, switchChainAsync],
  );

  return { signSafeTransactionAsync };
}
