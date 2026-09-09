import { applyRevFee, netCashOutValue, revFeeApplies } from "@/lib/feeHelpers";
import { decodeRulesetMetadata } from "@/lib/utils";
import {
  getJBContractAddress,
  getProjectTerminalStore,
  JBChainId,
  JBCoreContracts,
  jbMultiTerminalAbi,
  jbRulesetsAbi,
  jbTerminalStoreAbi,
} from "@bananapus/nana-sdk-core";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

export function useReclaimableSurplus(params: {
  chainId: JBChainId | undefined;
  projectId: bigint | undefined;
  tokenAmount: bigint | undefined;
  decimals: number;
  currencyId: number;
  /** The accounting-context (terminal) token, needed for feeFreeSurplusOf. */
  token: Address | undefined;
  /**
   * Whether this project is a revnet. Only a revnet has REVOwner as its cash-out data hook,
   * and only REVOwner charges the revnet fee — a plain project never pays it. Undefined
   * while the project row is still loading, which suppresses the fee rather than guessing.
   */
  isRevnet: boolean | undefined;
}) {
  const { chainId, projectId, tokenAmount, decimals, currencyId, token, isRevnet } = params;

  // The protocol charges the 2.5% fee on the whole reclaim when the current
  // ruleset's cash-out tax is nonzero, and only up to feeFreeSurplusOf when
  // the tax is zero (JBMultiTerminal._cashOutTokensOf). Read first: the revnet
  // fee below is gated on the same tax rate.
  const { data: currentRuleset } = useReadContract({
    abi: jbRulesetsAbi,
    address: chainId ? getJBContractAddress(JBCoreContracts.JBRulesets, 6, chainId) : undefined,
    functionName: "currentOf",
    chainId,
    args: projectId ? [projectId] : undefined,
  });
  const cashOutTaxRate = currentRuleset
    ? decodeRulesetMetadata(currentRuleset.metadata).cashOutTaxRate.value
    : undefined;

  /**
   * The revnet fee takes 2.5% of the TOKEN COUNT before the bonding-curve reclaim — but only
   * on a revnet, and only when the cash-out tax is nonzero: "Zero-tax ordinary cash-outs do
   * not add the revnet fee hook" (REVOwner.sol:303). Applying it unconditionally quoted every
   * zero-tax revnet, and every plain project, 2.5% low.
   */
  const chargesRevFee = revFeeApplies(isRevnet, cashOutTaxRate);
  const feeableTokenAmount =
    tokenAmount === undefined ? undefined : chargesRevFee ? applyRevFee(tokenAmount) : tokenAmount;

  const { data: raw, ...rest } = useReadContract({
    abi: jbTerminalStoreAbi,
    address: chainId ? getProjectTerminalStore(chainId, 6) : undefined,
    functionName: "currentReclaimableSurplusOf",
    chainId,
    args:
      projectId && feeableTokenAmount !== undefined && cashOutTaxRate !== undefined
        ? [projectId, feeableTokenAmount, [], [], BigInt(decimals), BigInt(currencyId)]
        : undefined,
  });

  const { data: feeFreeSurplus } = useReadContract({
    abi: jbMultiTerminalAbi,
    address: chainId
      ? getJBContractAddress(JBCoreContracts.JBMultiTerminal, 6, chainId)
      : undefined,
    functionName: "feeFreeSurplusOf",
    chainId,
    args: projectId && token ? [projectId, token] : undefined,
    query: { enabled: cashOutTaxRate === 0n && !!token },
  });

  const afterFees =
    raw !== undefined && cashOutTaxRate !== undefined
      ? cashOutTaxRate !== 0n
        ? netCashOutValue({ reclaimAmount: raw, cashOutTaxRate, feeFreeSurplus: 0n })
        : feeFreeSurplus !== undefined
          ? netCashOutValue({ reclaimAmount: raw, cashOutTaxRate, feeFreeSurplus })
          : undefined
      : undefined;

  return { data: afterFees, raw, ...rest };
}
