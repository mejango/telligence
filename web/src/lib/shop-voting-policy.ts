import { ReviewRefusal } from "@/lib/review-refusal";
import { SAFE_EXEC_ABI } from "@/lib/safe-service-config";
import { reserveWouldDeadlock } from "@/lib/shop-item-policy";
import { erc2771ForwarderAbi, jb721TiersHookAbi, revDeployerAbi } from "@bananapus/nana-sdk-core";
import { multiSendCallsOf } from "@bananapus/nana-sdk-core/safe";
import { decodeFunctionData, type Address, type Hex } from "viem";

/** Check only new authorization/funding, never mutate or reinterpret a signed recovery journal. */
export function requirePriceBasedShopVoting(data: Hex, to?: Address, operation = 0): void {
  const batch = multiSendCallsOf({ data, to, operation });
  if (batch) {
    for (const call of batch) requirePriceBasedShopVoting(call.data, call.to);
    return;
  }
  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: [...jb721TiersHookAbi, ...erc2771ForwarderAbi, ...revDeployerAbi, ...SAFE_EXEC_ABI],
      data,
    });
  } catch {
    return; // Other contract methods are outside this shop policy.
  }
  const tiers =
    decoded.functionName === "adjustTiers"
      ? decoded.args[0]
      : decoded.functionName === "deployFor" && decoded.args.length === 6
        ? decoded.args[4].baseline721HookConfiguration.tiersConfig.tiers
        : [];
  for (const tier of tiers) {
    if (tier.flags.useVotingUnits)
      throw new ReviewRefusal(
        "Saved shop items use custom voting power. Rebuild the items to use price-based voting.",
      );
    if (reserveWouldDeadlock(tier.initialSupply, tier.reserveFrequency))
      throw new ReviewRefusal(
        "A reserved item needs a supply of at least 2 (or unlimited). Rebuild the saved items.",
      );
  }
  if (decoded.functionName === "execTransaction") {
    requirePriceBasedShopVoting(decoded.args[2], decoded.args[0], decoded.args[3]);
  } else if (decoded.functionName === "execute") {
    requirePriceBasedShopVoting(decoded.args[0].data, decoded.args[0].to);
  }
}
