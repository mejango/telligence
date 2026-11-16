// https://github.com/rev-net/revnet-core/blob/main/script/Deploy.s.sol
import { USDC_DECIMALS } from "@/app/constants";
import { buildTierConfigs } from "@/components/shop/itemDraft";
import {
  isStickyRow,
  requireStickyDistributor,
  stickyDraftGroupId,
  stickyGroupOf,
} from "@/lib/sticky";
import {
  CashOutTaxRate,
  JBChainId,
  NATIVE_TOKEN,
  NATIVE_TOKEN_DECIMALS,
  SPLITS_TOTAL_PERCENT,
  USDC_ADDRESSES,
  WeightCutPercent,
} from "@bananapus/nana-sdk-core";
import {
  build721RulesetMetadata,
  buildAccountingContext,
  buildDeployRevnetTx,
  buildRevnet721Config,
  buildRevnetStageConfig,
  fillSplitPercents,
  REV_METADATA_ALLOW_SUCKER_DEPLOYMENT,
  RULESET_WEIGHT_INHERIT,
} from "@bananapus/nana-sdk-core/v6";
import { Address, parseUnits, zeroAddress } from "viem";
import { RevnetFormData } from "../types";
import { getStageCutFrequencySeconds, getStageStarts } from "./calculatePickupIssuance";
import { createBaseCurrency, createStorePricing } from "./createPricing";

export type DeployRevnetRequest = ReturnType<typeof buildDeployRevnetTx>;

export function parseDeployData(
  _formData: RevnetFormData,
  extra: {
    metadataCid: string;
    chainId: JBChainId;
    suckerDeployerConfig: {
      deployerConfigurations: {
        deployer: Address;
        peer: `0x${string}`;
        mappings: {
          localToken: Address;
          minGas: number;
          remoteToken: `0x${string}`;
        }[];
      }[];
    };
    timestamp: number;
    salt: `0x${string}`;
    creationFee: bigint;
  },
): DeployRevnetRequest {
  // hack: stringfy numbers
  const formData: RevnetFormData = JSON.parse(JSON.stringify(_formData), (_, value) =>
    typeof value === "number" ? String(value) : value,
  );
  const operator =
    formData?.operator.find((c) => Number(c.chainId) === Number(extra.chainId))?.address ||
    formData.stages[0].initialOperator;

  // Accounting-context currencies are ALWAYS token-keyed:
  // `uint32(uint160(token))`, native = 61166. The well-known ETH/USD ids
  // (1/2) are base-currency denominations only — encoding them as context
  // currencies is the convention violation this file used to carry.
  // `buildAccountingContext` defaults to `tokenCurrencyId(token)`.
  const baseCurrency = createBaseCurrency(formData);
  let tokenAddress: Address;
  let tokenDecimals: number;

  if (formData.reserveAsset === "CUSTOM") {
    tokenAddress = formData.customReserveAsset.address as Address;
    tokenDecimals = Number(formData.customReserveAsset.decimals);
  } else {
    const acceptsUsdc = formData.reserveAsset === "USDC" || formData.reserveAsset === "ETH_USDC";
    tokenAddress = acceptsUsdc ? USDC_ADDRESSES[extra.chainId] : NATIVE_TOKEN;
    tokenDecimals = acceptsUsdc ? USDC_DECIMALS : NATIVE_TOKEN_DECIMALS;
  }

  const nativeAccountingContext = buildAccountingContext(NATIVE_TOKEN, NATIVE_TOKEN_DECIMALS);
  const usdcAccountingContext = buildAccountingContext(
    USDC_ADDRESSES[extra.chainId],
    USDC_DECIMALS,
  );
  const accountingContextsToAccept =
    formData.reserveAsset === "CUSTOM"
      ? [buildAccountingContext(tokenAddress, tokenDecimals)]
      : formData.reserveAsset === "ETH_USDC"
        ? [nativeAccountingContext, usdcAccountingContext]
        : formData.reserveAsset === "USDC"
          ? [usdcAccountingContext]
          : [nativeAccountingContext];

  const stageStarts = getStageStarts(formData.stages, extra.timestamp);
  const stageConfigurations = formData.stages.map((stage, idx) => {
    const startsAtOrAfter = stageStarts[idx];
    // Every chain receives the FULL auto-issuance row list with the user-chosen
    // chainIds intact: REVDeployer folds all rows into `encodedConfiguration`
    // (which must be byte-identical across chains) and mints only the rows
    // whose chainId matches the chain it is deployed on.
    const autoIssuances = stage.autoIssuance.map((autoIssuance) => ({
      chainId: autoIssuance.chainId,
      count: autoIssuance.amount ? parseUnits(autoIssuance.amount, 18) : 0n,
      beneficiary: autoIssuance.beneficiary as Address,
    }));

    // The bucket's size in basis points out of 10_000. Two values, deliberately:
    //  - `splitBucketBps` keeps the EXACT entered total, because each row's share below is
    //    relative to what the user actually typed. Rounding first makes the shares sum to a
    //    different total and `fillSplitPercents` rejects the drift.
    //  - `splitPercent` is what gets encoded, and the field is a uint16. Summing float
    //    percentages lands off an integer for ordinary inputs — 10.5 + 19.505 gives 3000.5 —
    //    and viem then throws `RangeError: ... cannot be converted to a BigInt because it is
    //    not an integer`, blocking the deploy behind a generic toast. A basis point is the
    //    finest unit the field can express, so rounding loses nothing it could have carried.
    const splitBucketBps =
      stage.splits.reduce((sum, split) => sum + (Number(split.percentage) || 0), 0) * 100;
    const splitPercent = Math.round(splitBucketBps);
    // Scale each split to its share of the split bucket, then correct per-row rounding
    // drift so the group sums to exactly SPLITS_TOTAL_PERCENT (JBSplits reverts otherwise).
    const splitBucketPercents = fillSplitPercents(
      stage.splits.map((split) =>
        Math.round((Number(split.percentage) * 100 * SPLITS_TOTAL_PERCENT) / splitBucketBps),
      ),
    );
    const splits = stage.splits.map((split, splitIdx) => {
      // A Sticky row pays one token's holders on every chain: the distributor is the hook,
      // the token is the beneficiary, and the group rides in projectId.
      if (isStickyRow(split)) {
        return {
          preferAddToBalance: false,
          lockedUntil: 0,
          percent: splitBucketPercents[splitIdx],
          projectId: stickyDraftGroupId(stickyGroupOf(split)),
          beneficiary: split.defaultBeneficiary as Address,
          hook: requireStickyDistributor(extra.chainId),
        };
      }
      let beneficiary = split.beneficiary?.find(
        (b) => Number(b?.chainId) === Number(extra.chainId),
      )?.address;
      if (!beneficiary) {
        beneficiary = split.defaultBeneficiary;
      }
      if (!beneficiary) throw new Error("Beneficiary not found");
      return {
        preferAddToBalance: false,
        lockedUntil: 0,
        percent: splitBucketPercents[splitIdx],
        projectId: 0n,
        beneficiary: beneficiary as Address,
        hook: zeroAddress,
      };
    });

    return buildRevnetStageConfig({
      startsAtOrAfter,
      autoIssuances,
      splitPercent,
      splits,
      initialIssuance:
        stage.pickUpFromPrevious && idx > 0
          ? RULESET_WEIGHT_INHERIT
          : stage.initialIssuance && stage.initialIssuance !== ""
            ? parseUnits(`${stage.initialIssuance}`, 18)
            : 0n,
      issuanceCutFrequency: getStageCutFrequencySeconds(stage),
      // Same integer requirement as splitPercent above: these divisions can leave a fraction
      // that the ABI encoder rejects outright.
      issuanceCutPercent: Math.round(
        Number(WeightCutPercent.parse(stage.priceCeilingIncreasePercentage, 9).value) / 100,
      ),
      cashOutTaxRate: Math.round(
        Number(CashOutTaxRate.parse(stage.priceFloorTaxIntensity, 4).value) / 100,
      ),
      // `REVDeployer.deploySuckersFor` reads bit 2 of the CURRENT stage's app
      // metadata and reverts without it (REVDeployer.sol:646-650). Stages are
      // immutable, so a stage that ships without the bit can never be extended
      // to another chain. `buildRevnetStageConfig` sets it by default, but the
      // 721 metadata is composed here, so it is re-applied explicitly.
      extraMetadata:
        build721RulesetMetadata({
          metadata: Number(stage.extraMetadata ?? 0),
          // Keep the collection-level gate permanently closed. Each tier's
          // immutable `transfersPausable` flag is then a fixed policy:
          // false = transferable, true = non-transferable. No later stage can
          // switch an item from one behavior to the other.
          pauseTransfers: true,
        }) | REV_METADATA_ALLOW_SUCKER_DEPLOYMENT,
    });
  });

  // Shop prices follow their currency, independently of the reserve token.
  const storePricing = createStorePricing(formData);

  const tiers = buildTierConfigs(formData.store.items, storePricing.decimals, extra.chainId);
  if (typeof tiers === "string") throw new Error(tiers);

  const tiered721Config = buildRevnet721Config({
    ...storeIdentity(formData),
    contractUri: extra.metadataCid,
    salt: extra.salt,
    pricing: storePricing,
    tiers,
    flags: {
      noNewTiersWithReserves: formData.store.noNewTiersWithReserves,
      noNewTiersWithVotes: formData.store.noNewTiersWithVotes,
      noNewTiersWithOwnerMinting: formData.store.noNewTiersWithOwnerMinting,
      preventOverspending: formData.store.preventOverspending,
    },
    operatorPermissions: {
      canAdjustTiers: formData.store.operatorCanAdjustTiers,
      canUpdateMetadata: formData.store.operatorCanUpdateMetadata,
      canMint: formData.store.operatorCanMint,
      canIncreaseDiscountPercent: formData.store.operatorCanIncreaseDiscount,
    },
  });

  return buildDeployRevnetTx({
    chainId: extra.chainId,
    config: {
      description: {
        name: formData.name,
        ticker: formData.tokenSymbol,
        uri: extra.metadataCid,
        salt: extra.salt,
      },
      baseCurrency: baseCurrency,
      operator: operator as Address,
      scopeCashOutsToLocalBalances: false,
      stageConfigurations,
    },
    accountingContexts: accountingContextsToAccept,
    suckerConfig: {
      deployerConfigurations: extra.suckerDeployerConfig.deployerConfigurations,
      salt: extra.salt,
    },
    creationFee: extra.creationFee,
    tiered721Config,
    allowedPosts: [],
  });
}

/** The shop collection's name and symbol as launched: what was typed, else taken from the revnet. */
export function storeIdentity(formData: {
  name: string;
  tokenSymbol: string;
  store: { collectionName: string; collectionSymbol: string };
}): { name: string; symbol: string } {
  return {
    name: formData.store.collectionName.trim() || `${formData.name} Store`,
    symbol: formData.store.collectionSymbol.trim() || `${formData.tokenSymbol}STORE`,
  };
}
