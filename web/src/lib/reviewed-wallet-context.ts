import { isSafeConnection } from "@/lib/safe-connector";
import { requireNoViewAs } from "@/lib/view-as";
import type { Address } from "viem";
import type { Config } from "wagmi";
import { getAccount } from "wagmi/actions";

/** Capture before review; invoke synchronously after the last await before using the wallet. */
export function captureReviewedWalletContext(
  config: Config,
  expectedAccount: Address,
  accountChangedMessage: string,
  chainChangedMessage = accountChangedMessage,
): (chainId?: number) => void {
  const safe = isSafeConnection(config);
  const requireContext = (chainId?: number) => {
    requireNoViewAs();
    const current = getAccount(config);
    if (current.address?.toLowerCase() !== expectedAccount.toLowerCase()) {
      throw new Error(accountChangedMessage);
    }
    if (chainId !== undefined && current.chainId !== chainId) {
      throw new Error(chainChangedMessage);
    }
    if (isSafeConnection(config) !== safe) {
      throw new Error("Wallet connection changed. Review the transaction again.");
    }
  };
  requireContext();
  return requireContext;
}
