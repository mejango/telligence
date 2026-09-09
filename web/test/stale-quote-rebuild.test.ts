import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import { ensureFreshQuote, quotedStageStartOf } from "@/app/create/helpers/staleQuote";
import type { ChainPayment, RelayrPostBundleResponse } from "@/lib/nana/types";
import { baseSepolia, sepolia } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SUCKER_CONFIG, TEST_SALT, TEST_TIMESTAMP, validRevnetForm } from "./fixtures/revnet";

const CREATION_FEE = 123_456n;
const CHAIN_IDS = [sepolia.id, baseSepolia.id] as const;
const NOW = TEST_TIMESTAMP + 3_600;

function multiChainForm() {
  const form = validRevnetForm();
  form.chainIds = [...CHAIN_IDS];
  form.stages.push({ ...structuredClone(form.stages[0]), stageStart: "30" });
  return form;
}

function requestsFor(form: ReturnType<typeof validRevnetForm>, timestamp: number) {
  return CHAIN_IDS.map((chainId) =>
    parseDeployData(form, {
      metadataCid: "bafy-metadata",
      chainId,
      suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
      timestamp,
      salt: TEST_SALT,
      creationFee: CREATION_FEE,
    }),
  );
}

function stageTimeline(request: ReturnType<typeof parseDeployData>): number[] {
  const [, config] = request.args;
  return config.stageConfigurations.map((stage) => Number(stage.startsAtOrAfter));
}

function chainPayment(chain: number, token = "0x00000000000000000000000000000000000000ee") {
  return {
    amount: "0x1",
    calldata: "0x",
    chain,
    payment_deadline: String((NOW + 3_600) * 1_000),
    target: "0x000000000000000000000000000000000000f00d",
    token,
  } as unknown as ChainPayment;
}

function bundle(uuid: string, payments: ChainPayment[]): RelayrPostBundleResponse {
  return { bundle_uuid: uuid, payment_info: payments, per_txn: [], txn_uuids: [] };
}

describe("stale-quote rebuild — frozen stage starts and the 7-day cash-out delay", () => {
  it("rebuilding with one fresh timestamp shifts every chain's timeline identically", () => {
    const form = multiChainForm();
    const stale = requestsFor(form, TEST_TIMESTAMP);
    const freshTimestamp = TEST_TIMESTAMP + 86_400;
    const rebuilt = requestsFor(form, freshTimestamp);

    // All chains in a bundle share the frozen quote-time start...
    const staleStarts = stale.map((request) => quotedStageStartOf(request, form));
    expect(new Set(staleStarts.map((start) => start.timestamp)).size).toBe(1);
    expect(staleStarts[0]).toEqual({ timestamp: TEST_TIMESTAMP + 600, explicit: false });

    // ...and the rebuild shares one fresh start across all of them.
    const rebuiltStarts = rebuilt.map((request) => quotedStageStartOf(request, form).timestamp);
    expect(new Set(rebuiltStarts).size).toBe(1);
    expect(rebuiltStarts[0]).toBe(freshTimestamp + 600);
    expect(rebuiltStarts[0]).toBeGreaterThan(staleStarts[0].timestamp);

    // Later stage boundaries chain off the fresh anchor, identically per chain.
    expect(stageTimeline(rebuilt[0])).toEqual(stageTimeline(rebuilt[1]));
    expect(stageTimeline(rebuilt[0])[1]).toBe(freshTimestamp + 600 + 30 * 86_400);
  });

  it("marks a user-chosen future start as explicit", () => {
    const form = multiChainForm();
    form.stages[0].futureStartTimestamp = TEST_TIMESTAMP + 7_200;
    const [request] = requestsFor(form, TEST_TIMESTAMP);
    expect(quotedStageStartOf(request, form)).toEqual({
      timestamp: TEST_TIMESTAMP + 7_200,
      explicit: true,
    });
  });

  it("pays a still-fresh quote as-is without rebuilding", async () => {
    const payment = chainPayment(sepolia.id);
    const quoted = bundle("stale-uuid", [payment]);
    const rebuildStaleQuote = vi.fn();

    const result = await ensureFreshQuote({
      bundle: quoted,
      payment,
      quotedStageStart: { timestamp: NOW + 600, explicit: false },
      rebuildStaleQuote,
      nowSeconds: NOW,
    });

    expect(result).toEqual({ bundle: quoted, payment });
    expect(rebuildStaleQuote).not.toHaveBeenCalled();
  });

  it("rebuilds a stale default-start quote and pays the refreshed bundle", async () => {
    const payment = chainPayment(sepolia.id);
    const refreshedPayment = chainPayment(sepolia.id);
    const refreshed = bundle("fresh-uuid", [chainPayment(baseSepolia.id), refreshedPayment]);
    const rebuildStaleQuote = vi.fn().mockResolvedValue(refreshed);
    const onRebuild = vi.fn();

    const result = await ensureFreshQuote({
      bundle: bundle("stale-uuid", [payment]),
      payment,
      quotedStageStart: { timestamp: NOW + 60, explicit: false },
      rebuildStaleQuote,
      onRebuild,
      nowSeconds: NOW,
    });

    expect(rebuildStaleQuote).toHaveBeenCalledTimes(1);
    expect(onRebuild).toHaveBeenCalledTimes(1);
    expect(result.bundle).toBe(refreshed);
    expect(result.payment).toBe(refreshedPayment);
  });

  it("refuses to silently rebuild past an explicit start the user chose", async () => {
    const payment = chainPayment(sepolia.id);
    const rebuildStaleQuote = vi.fn();

    await expect(
      ensureFreshQuote({
        bundle: bundle("stale-uuid", [payment]),
        payment,
        quotedStageStart: { timestamp: NOW - 60, explicit: true },
        rebuildStaleQuote,
        nowSeconds: NOW,
      }),
    ).rejects.toThrow(/set a later start time/);
    expect(rebuildStaleQuote).not.toHaveBeenCalled();
  });

  it("blocks a stale payment outright when no rebuild path is wired", async () => {
    const payment = chainPayment(sepolia.id);

    await expect(
      ensureFreshQuote({
        bundle: bundle("stale-uuid", [payment]),
        payment,
        quotedStageStart: { timestamp: NOW - 60, explicit: false },
        nowSeconds: NOW,
      }),
    ).rejects.toThrow(/lock cash-outs and loans for 7 days/);
  });

  it("fails closed when the refreshed quote drops the selected payment option", async () => {
    const payment = chainPayment(sepolia.id);
    const refreshed = bundle("fresh-uuid", [chainPayment(baseSepolia.id)]);

    await expect(
      ensureFreshQuote({
        bundle: bundle("stale-uuid", [payment]),
        payment,
        quotedStageStart: { timestamp: NOW - 60, explicit: false },
        rebuildStaleQuote: vi.fn().mockResolvedValue(refreshed),
        nowSeconds: NOW,
      }),
    ).rejects.toThrow(/Select a payment again/);
  });
});
