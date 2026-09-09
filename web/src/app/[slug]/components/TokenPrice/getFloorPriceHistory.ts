import { usdRateOf } from "@/lib/baseCurrencyRate";
import {
  CashOutTaxSnapshotsOperation,
  SuckerGroupMomentsOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { CashOutTaxSnapshot, SuckerGroupMoment } from "@/lib/bendystraw/types";
import {
  downsampleTimeSeries,
  getTokenCashOutQuoteEth,
  JB_TOKEN_DECIMALS,
} from "@bananapus/nana-sdk-core";
import { formatUnits, parseUnits } from "viem";
import { explainCashOutChange } from "./explainCashOutChange";
import type { PriceDataPoint } from "./getTokenPriceChartData";

type FloorPriceOptions = {
  suckerGroupId: string;
  chainId: number;
  baseTokenDecimals: number;
  currentCashOutTax?: number;
  projectStart: number;
};

const MAX_DISPLAY_POINTS = 3000;

async function fetchAllTaxSnapshots(
  chainId: number,
  suckerGroupId: string,
): Promise<CashOutTaxSnapshot[]> {
  const allItems: CashOutTaxSnapshot[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  while (true) {
    const result = await queryBendystraw(chainId, CashOutTaxSnapshotsOperation, {
      suckerGroupId,
      after: cursor,
    });

    allItems.push(...(result.cashOutTaxSnapshots?.items ?? []));

    const pageInfo = result.cashOutTaxSnapshots?.pageInfo;
    cursor = pageInfo?.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
    if (!cursor) break;
    if (seenCursors.has(cursor)) {
      throw new Error("Cash-out tax history returned a cyclic cursor");
    }
    seenCursors.add(cursor);
  }

  return allItems;
}

async function fetchAllMoments(
  chainId: number,
  suckerGroupId: string,
): Promise<SuckerGroupMoment[]> {
  const allItems: SuckerGroupMoment[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  while (true) {
    const result = await queryBendystraw(chainId, SuckerGroupMomentsOperation, {
      suckerGroupId,
      after: cursor,
    });

    allItems.push(...(result.suckerGroupMoments?.items ?? []));

    const pageInfo = result.suckerGroupMoments?.pageInfo;
    cursor = pageInfo?.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
    if (!cursor) break;
    if (seenCursors.has(cursor)) {
      throw new Error("Treasury history returned a cyclic cursor");
    }
    seenCursors.add(cursor);
  }

  return allItems;
}

export async function getFloorPriceHistory(options: FloorPriceOptions): Promise<PriceDataPoint[]> {
  const { suckerGroupId, chainId, baseTokenDecimals, currentCashOutTax, projectStart } = options;

  const [taxSnapshots, moments] = await Promise.all([
    fetchAllTaxSnapshots(chainId, suckerGroupId),
    fetchAllMoments(chainId, suckerGroupId),
  ]);

  const dataPoints: PriceDataPoint[] = [];
  const orderedMoments = [...moments].sort((a, b) => a.timestamp - b.timestamp);

  const firstMomentTimestamp = orderedMoments.length > 0 ? orderedMoments[0].timestamp : undefined;
  if (projectStart && (!firstMomentTimestamp || firstMomentTimestamp > projectStart)) {
    dataPoints.push({
      timestamp: projectStart,
      floorPrice: 0,
      cashOutTaxRate: findApplicableTaxRate(projectStart, taxSnapshots, currentCashOutTax),
    });
  }

  if (orderedMoments.length === 0) {
    return dataPoints;
  }

  let previous:
    | {
        balance: bigint;
        tokenSupply: bigint;
        cashOutTax: number;
        price: number;
      }
    | undefined;
  for (const moment of orderedMoments) {
    const cashOutTax = findApplicableTaxRate(moment.timestamp, taxSnapshots, currentCashOutTax);

    if (cashOutTax === undefined) continue;

    const balance = BigInt(moment.balance);
    const tokenSupply = BigInt(moment.tokenSupply);
    const floorPrice = calculateFloorPrice(balance, tokenSupply, cashOutTax, baseTokenDecimals);
    const current = {
      balance,
      tokenSupply,
      cashOutTax,
      price: floorPrice,
    };

    dataPoints.push({
      timestamp: moment.timestamp,
      floorPrice,
      cashOutChangeReason: explainCashOutChange(previous, current),
      totalSupply: String(moment.tokenSupply),
      totalBalance: String(moment.balance),
      cashOutTaxRate: cashOutTax,
      accountingTokenUsdRate: usdRateOf(moment.accountingTokenUsdRate),
    });
    previous = current;
  }

  return downsampleTimeSeries(
    dataPoints,
    MAX_DISPLAY_POINTS,
    (point) => point.timestamp,
    (point) => point.floorPrice ?? 0,
  );
}

/**
 * Formula: y = (o * x / s) * ((1 - r) + (r * x / s))
 *
 * Where:
 * - r = cash out tax rate (0 to 1)
 * - o = surplus (balance in base token smallest unit)
 * - s = total token supply
 * - x = amount of tokens to cash out
 * - y = base token returned
 */
function calculateFloorPrice(
  balance: bigint,
  tokenSupply: bigint,
  cashOutTax: number,
  baseTokenDecimals: number,
  tokenAmount = parseUnits("1", JB_TOKEN_DECIMALS),
): number {
  if (tokenSupply === 0n || balance === 0n) return 0;

  const returned = getTokenCashOutQuoteEth(tokenAmount, {
    overflowWei: balance,
    totalSupply: tokenSupply,
    cashOutTaxRate: Math.max(0, Math.min(10_000, Math.trunc(cashOutTax))),
    tokensReserved: 0n,
  });

  return Number(formatUnits(returned, baseTokenDecimals));
}

function findApplicableTaxRate(
  timestamp: number,
  snapshots: CashOutTaxSnapshot[],
  fallback?: number,
): number | undefined {
  let applicableTax: number | undefined = fallback;

  for (const snapshot of snapshots) {
    const start = Number(snapshot.start);
    if (start <= timestamp) {
      applicableTax = snapshot.cashOutTax;
    } else {
      break;
    }
  }

  return applicableTax;
}
