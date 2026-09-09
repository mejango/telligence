import { JBChainId, revLoansAbi } from "@bananapus/nana-sdk-core";
import { Address } from "viem";
import { useReadContract } from "wagmi";

/**
 * V6 returns `(borrowableNow, borrowableCapacity)`.
 *
 * `data` is `borrowableNow` — capped at the terminal's live balance, the right quote for
 * opening a NEW borrow, which draws live funds.
 *
 * `capacity` is the economic ceiling — the value the contract uses when valuing EXISTING
 * collateral while repaying or reallocating a loan; its solvency checks ignore the live
 * treasury surplus, so a drawn-down treasury must not shrink those quotes.
 */
export function useBorrowableAmountFrom({
  address,
  chainId,
  args,
}: {
  address: Address | undefined;
  chainId?: JBChainId;
  args?: readonly [bigint, bigint, bigint, bigint];
}) {
  const query = useReadContract({
    abi: revLoansAbi,
    functionName: "borrowableAmountFrom",
    address,
    chainId,
    args,
  });

  return { ...query, data: query.data?.[0], capacity: query.data?.[1] };
}
