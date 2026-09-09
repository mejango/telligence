import type { ChainPayment, RelayrPostBundleResponse } from "@/lib/nana/types";
import type { RevnetFormData } from "../types";
import type { DeployRevnetRequest } from "./parseDeployData";

// REVDeployer locks cash-outs and loans for 7 days when the first stage's
// non-zero start time is already past at execution (CASH_OUT_DELAY,
// REVDeployer.sol). A Relayr quote freezes that start time, so paying this
// close to (or past) it must first rebuild the request with a fresh timestamp.
const STALE_START_MARGIN_SECONDS = 120;

export type QuotedStageStart = {
  timestamp: number;
  explicit: boolean;
};

/** The first stage's start time as actually encoded in a deploy request. */
export function quotedStageStartOf(
  request: DeployRevnetRequest,
  formData: RevnetFormData,
): QuotedStageStart {
  const [, config] = request.args;
  return {
    timestamp: Number(config.stageConfigurations[0].startsAtOrAfter),
    explicit: Number(formData.stages[0].futureStartTimestamp) > 0,
  };
}

function stageStartIsStale(start: QuotedStageStart | undefined, nowSeconds: number): boolean {
  return !!start && start.timestamp <= nowSeconds + STALE_START_MARGIN_SECONDS;
}

/**
 * Gate a Relayr payment on the quote's encoded stage start still being in the
 * future. When the default start went stale, rebuild the whole deploy request —
 * one fresh timestamp shared by every chain, since the encoded configuration
 * must stay byte-identical across chains for suckers to pair — and pay the
 * refreshed bundle instead.
 */
export async function ensureFreshQuote(options: {
  bundle: RelayrPostBundleResponse;
  payment: ChainPayment;
  quotedStageStart?: QuotedStageStart;
  rebuildStaleQuote?: () => Promise<RelayrPostBundleResponse>;
  onRebuild?: () => void;
  nowSeconds?: number;
}): Promise<{ bundle: RelayrPostBundleResponse; payment: ChainPayment }> {
  const { bundle, payment, quotedStageStart, rebuildStaleQuote, onRebuild } = options;
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!stageStartIsStale(quotedStageStart, nowSeconds)) return { bundle, payment };
  if (quotedStageStart?.explicit) {
    throw new Error(
      "The start time this quote encodes has passed; deploying now would lock cash-outs and loans for 7 days. Clear the quote, set a later start time, and get a new quote.",
    );
  }
  if (!rebuildStaleQuote) {
    throw new Error(
      "The start time this quote encodes has passed; deploying now would lock cash-outs and loans for 7 days. Clear the quote and get a new one.",
    );
  }
  onRebuild?.();
  const rebuilt = await rebuildStaleQuote();
  const refreshed = rebuilt.payment_info.find(
    (candidate) =>
      candidate.chain === payment.chain &&
      candidate.token.toLowerCase() === payment.token.toLowerCase(),
  );
  if (!refreshed) {
    throw new Error(
      "The refreshed quote no longer offers the selected payment option. Select a payment again.",
    );
  }
  return { bundle: rebuilt, payment: refreshed };
}
