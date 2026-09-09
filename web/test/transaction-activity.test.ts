import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "revnet:transaction-activities:v1";
const HASH = `0x${"ab".repeat(32)}` as Hex;
const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;

async function freshActivityModule() {
  vi.resetModules();
  return import("@/lib/transaction-activity");
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("transaction activity persistence", () => {
  it("records, persists, updates, resolves hashes case-insensitively, and dismisses", async () => {
    const activity = await freshActivityModule();
    const listener = vi.fn();
    const unsubscribe = activity.subscribeTransactionActivities(listener);

    const recorded = activity.recordTransactionActivity({
      id: "tx:1:test",
      kind: "direct",
      title: "Pay",
      status: "submitted",
      message: "Wallet accepted",
      chainId: 1,
      account: ACCOUNT,
      hash: HASH,
    });

    expect(recorded.createdAt).toBeGreaterThan(0);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(1);
    expect(activity.transactionActivityForHash(HASH.toUpperCase() as Hex)?.id).toBe(recorded.id);

    activity.updateTransactionActivity(recorded.id, {
      status: "success",
      message: "Confirmed onchain.",
    });
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "success",
      message: "Confirmed onchain.",
      createdAt: recorded.createdAt,
    });

    activity.dismissTransactionActivity(recorded.id);
    expect(activity.transactionActivitySnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("deduplicates by id, keeps the newest activity first, and never evicts in-flight locks", async () => {
    const activity = await freshActivityModule();
    for (let index = 0; index < 25; index += 1) {
      activity.recordTransactionActivity({
        id: `tx:${index}`,
        kind: "direct",
        title: `Transaction ${index}`,
        status: "pending",
        message: "Pending",
      });
    }

    expect(activity.transactionActivitySnapshot()).toHaveLength(25);
    expect(activity.transactionActivitySnapshot()[0].id).toBe("tx:24");
    expect(activity.transactionActivitySnapshot().at(-1)?.id).toBe("tx:0");

    activity.recordTransactionActivity({
      id: "tx:10",
      kind: "direct",
      title: "Updated transaction",
      status: "failed",
      message: "Reverted",
    });
    expect(activity.transactionActivitySnapshot()).toHaveLength(25);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      id: "tx:10",
      title: "Updated transaction",
      status: "failed",
    });
  });

  it("caps terminal history without evicting an older pending Safe proposal", async () => {
    const activity = await freshActivityModule();
    activity.recordTransactionActivity({
      id: "handle:safe",
      kind: "safe",
      title: "Publish project handle",
      status: "safe-proposed",
      message: "Awaiting Safe execution",
      callKey: "operator:1:handles:calldata",
    });
    for (let index = 0; index < 25; index += 1) {
      activity.recordTransactionActivity({
        id: `terminal:${index}`,
        kind: "direct",
        title: `Completed transaction ${index}`,
        status: "success",
        message: "Confirmed",
      });
    }

    const rows = activity.transactionActivitySnapshot();
    expect(rows).toHaveLength(21);
    expect(rows.filter((row) => row.status === "success")).toHaveLength(20);
    expect(rows.find((row) => row.id === "handle:safe")).toMatchObject({
      status: "safe-proposed",
      callKey: "operator:1:handles:calldata",
    });

    const hydrated = await freshActivityModule();
    expect(
      hydrated.transactionActivitySnapshot().find((row) => row.id === "handle:safe"),
    ).toMatchObject({ status: "safe-proposed" });
  });

  it("merges a sibling tab's pending lock before recording local activity", async () => {
    const activity = await freshActivityModule();
    activity.transactionActivitySnapshot();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "sibling:handle",
          kind: "safe",
          title: "Publish project handle",
          status: "safe-proposed",
          message: "Awaiting Safe execution",
          callKey: "operator:1:handles:calldata",
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );

    activity.recordTransactionActivity({
      id: "local:complete",
      kind: "direct",
      title: "Other transaction",
      status: "success",
      message: "Confirmed",
    });

    expect(activity.transactionActivitySnapshot().map((row) => row.id)).toEqual([
      "local:complete",
      "sibling:handle",
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sibling:handle", status: "safe-proposed" }),
      ]),
    );
  });

  it("hydrates persisted state and fails safely on malformed storage", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `stored:${index}`,
      kind: "direct",
      title: "Stored",
      status: "pending",
      message: "Pending",
      createdAt: index,
      updatedAt: index,
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));

    const hydrated = await freshActivityModule();
    expect(hydrated.transactionActivitySnapshot()).toHaveLength(25);

    window.localStorage.setItem(STORAGE_KEY, "not json");
    const malformed = await freshActivityModule();
    expect(malformed.transactionActivitySnapshot()).toEqual([]);
    expect(() => malformed.requireTransactionActivityPersistence()).toThrow(
      /storage is unavailable/,
    );
    malformed.recordTransactionActivity({
      id: "new",
      kind: "direct",
      title: "New",
      status: "pending",
      message: "Pending",
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("not json");
    expect(() => malformed.requireTransactionActivityPersistence()).toThrow(
      /storage is unavailable/,
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    expect(() => malformed.requireTransactionActivityPersistence()).not.toThrow();
    expect(malformed.transactionActivitySnapshot()).toHaveLength(25);
  });

  it("ignores updates for unknown ids", async () => {
    const activity = await freshActivityModule();
    activity.updateTransactionActivity("missing", { status: "failed" });
    expect(activity.transactionActivitySnapshot()).toEqual([]);
  });

  it("keeps an action-specific verification hold from being overwritten by generic success", async () => {
    const activity = await freshActivityModule();
    activity.recordTransactionActivity({
      id: `tx:1:${HASH}`,
      kind: "direct",
      title: "execTransaction",
      status: "pending",
      message: "Pending onchain confirmation.",
      hash: HASH,
    });

    activity.holdTransactionActivityForVerification(
      HASH,
      "Mined, but the exact Safe event or handle result could not be verified.",
    );
    activity.updateTransactionActivity(`tx:1:${HASH}`, {
      status: "success",
      message: "Confirmed onchain.",
    });

    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "pending",
      manualVerificationRequired: true,
      message: "Mined, but the exact Safe event or handle result could not be verified.",
    });

    activity.releaseTransactionActivityVerification(HASH, "Exact handle result confirmed.");
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "success",
      manualVerificationRequired: false,
      message: "Exact handle result confirmed.",
    });

    activity.failTransactionActivityVerification(HASH, "Exact handle verification failed.");
    activity.updateTransactionActivity(`tx:1:${HASH}`, {
      status: "success",
      message: "Confirmed onchain.",
    });
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "failed",
      manualVerificationRequired: true,
      message: "Exact handle verification failed.",
    });
  });
});
