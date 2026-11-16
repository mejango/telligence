import { issuanceBaseCurrencyLabel } from "@/app/[slug]/components/v6/terms/chartUtils";
import { isSupportedChainId, RESERVED_TOKEN_SPLIT_GROUP_ID } from "@/app/constants";
import { StoreAutoIssuanceAmountEventsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { revertedNonexistentToken } from "@/lib/contract-revert";
import { formatAdaptivePercent } from "@/lib/formatPercent";
import { readAllProjectRulesets } from "@/lib/nana/rulesets";
import { decodeRulesetMetadata } from "@/lib/utils";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  getJBContractAddress,
  JBCoreContracts,
  jbProjectsAbi,
  jbRulesetsAbi,
  jbSplitsAbi,
  RevnetCoreContracts,
  WeightCutPercent,
} from "@bananapus/nana-sdk-core";
import { NextRequest, NextResponse } from "next/server";
import { formatUnits, isAddressEqual } from "viem";

export const dynamic = "force-dynamic";

const units = {
  blockNumber: "the block the stages were read at",
  currentStage:
    "zero-based index into stages of the stage in effect now; null before the first stage starts",
  currentIssuance:
    "tokens created per 1 unit of the current stage's baseCurrency paid now, with the cuts so far applied and before splitPercent is taken out; raw has 18 decimals",
  start: "value is ISO 8601 UTC; raw is Unix seconds. A stage runs until the next one starts",
  issuance:
    "value is tokens created per 1 unit of baseCurrency paid at the start of the stage, before splitPercent is taken out and before any cuts; raw has 18 decimals",
  baseCurrency: "raw is the currency id: 1 is ETH, 2 is USD, anything else is a token's currency",
  issuanceCutPercent: "how much issuance drops every issuanceCutFrequency; raw is out of 1e9",
  issuanceCutFrequency: "value is days; raw is seconds",
  splitPercent:
    "value is the share of new tokens set aside for the stage's split recipients, null when it has none; raw is out of 10,000",
  cashOutTax: "value is 0 to 1; raw is out of 10,000",
  autoIssuance:
    "tokens the stage creates without payment, on this chain; raw has 18 decimals; null when the indexed record is unavailable",
};

// The Terms tab shows token counts as whole numbers.
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const tokens = (count: bigint) => whole.format(Number(formatUnits(count, 18)));
// Its current rate keeps three decimals.
const rate = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** A revnet's stages in the units its Terms tab shows, each beside its onchain value. */
export async function GET(request: NextRequest) {
  const chainId = Number(request.nextUrl.searchParams.get("chainId"));
  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (
    !Number.isSafeInteger(chainId) ||
    !isSupportedChainId(chainId) ||
    !Number.isSafeInteger(projectId) ||
    projectId <= 0
  ) {
    return NextResponse.json({ error: "Bad params" }, { status: 400 });
  }
  const notRevnet = NextResponse.json(
    { error: `Project ${projectId} on chain ${chainId} is not a revnet.` },
    { status: 404 },
  );
  try {
    const client = getViemPublicClient(chainId);
    const id = BigInt(projectId);
    const blockNumber = await client.getBlockNumber();
    // Every chain read below answers for this one block.
    const read: typeof client.readContract = (parameters) =>
      client.readContract({ ...parameters, blockNumber } as never) as never;

    let owner;
    try {
      owner = await read({
        address: getJBContractAddress(JBCoreContracts.JBProjects, 6, chainId),
        abi: jbProjectsAbi,
        functionName: "ownerOf",
        args: [id],
      });
    } catch (error) {
      if (revertedNonexistentToken(error)) return notRevnet;
      throw error;
    }
    if (!isAddressEqual(owner, getJBContractAddress(RevnetCoreContracts.REVOwner, 6, chainId)))
      return notRevnet;

    const rulesetsAddress = getJBContractAddress(JBCoreContracts.JBRulesets, 6, chainId);
    const [rulesets, live, autoIssuances] = await Promise.all([
      readAllProjectRulesets({ readContract: read }, rulesetsAddress, id).then((rows) =>
        rows.sort((a, b) => a.start - b.start),
      ),
      read({ address: rulesetsAddress, abi: jbRulesetsAbi, functionName: "currentOf", args: [id] }),
      queryBendystraw(chainId, StoreAutoIssuanceAmountEventsOperation, {
        where: { projectId, chainId, version: 6 },
      })
        .then((data) => data.storeAutoIssuanceAmountEvents.items)
        .catch(() => null),
    ]);
    const splits = await Promise.all(
      rulesets.map((ruleset) =>
        read({
          address: getJBContractAddress(JBCoreContracts.JBSplits, 6, chainId),
          abi: jbSplitsAbi,
          functionName: "splitsOf",
          args: [id, BigInt(ruleset.id), RESERVED_TOKEN_SPLIT_GROUP_ID],
        }),
      ),
    );

    const now = Date.now() / 1000;
    const currentStage = rulesets.findIndex(
      (ruleset, i) => now >= ruleset.start && now < (rulesets[i + 1]?.start ?? Infinity),
    );
    const stages = rulesets.map((ruleset, i) => {
      const metadata = decodeRulesetMetadata(ruleset.metadata);
      const autoIssuance = autoIssuances
        ?.filter((row) => Number(row.stageId) === ruleset.id)
        .reduce((total, row) => total + BigInt(row.count), 0n);
      return {
        rulesetId: ruleset.id,
        start: { value: new Date(ruleset.start * 1000).toISOString(), raw: ruleset.start },
        issuance: { value: tokens(ruleset.weight), raw: ruleset.weight.toString() },
        baseCurrency: {
          value: issuanceBaseCurrencyLabel(
            metadata.baseCurrency,
            `currency ${metadata.baseCurrency}`,
          ),
          raw: metadata.baseCurrency,
        },
        issuanceCutPercent: {
          value: `${formatAdaptivePercent(new WeightCutPercent(ruleset.weightCutPercent).toFloat() * 100)}%`,
          raw: ruleset.weightCutPercent,
        },
        issuanceCutFrequency: { value: ruleset.duration / 86400, raw: ruleset.duration },
        splitPercent: {
          value: splits[i].length > 0 ? `${metadata.reservedPercent.formatPercentage()}%` : null,
          raw: Number(metadata.reservedPercent.value),
        },
        cashOutTax: {
          value: metadata.cashOutTaxRate.format(),
          raw: Number(metadata.cashOutTaxRate.value),
        },
        autoIssuance:
          autoIssuance === undefined
            ? null
            : { value: tokens(autoIssuance), raw: autoIssuance.toString() },
      };
    });
    return NextResponse.json(
      {
        chainId,
        projectId,
        blockNumber: blockNumber.toString(),
        currentStage: currentStage < 0 ? null : currentStage,
        currentIssuance: live.id
          ? {
              value: rate.format(Number(formatUnits(live.weight, 18))),
              raw: live.weight.toString(),
            }
          : null,
        stages,
        units,
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "Stages are unavailable." }, { status: 503 });
  }
}
