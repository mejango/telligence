import { parsePendingLaunch } from "@/lib/telligence/pending-launch";
import { DEFAULT_COMPUTE_DRAFT } from "@/lib/telligence/types";
import { describe, expect, it } from "vitest";

const creator = "0x1111111111111111111111111111111111111111";
const pending = {
  version: 1,
  creator,
  factory: "0x2222222222222222222222222222222222222222",
  hash: `0x${"ab".repeat(32)}`,
  preparationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  draft: {
    ...DEFAULT_COMPUTE_DRAFT,
    name: "Archive",
    purpose: "Archive public records for anyone to search",
    workload: "Search records",
  },
};

describe("untrusted pending launch records", () => {
  it.each(["-".repeat(36), "a".repeat(36), "aaaaaaaa-aaaa-0aaa-0aaa-aaaaaaaaaaaa"])(
    "rejects invalid preparation UUID %s",
    (preparationId) => {
      expect(parsePendingLaunch(JSON.stringify({ ...pending, preparationId }), creator)).toBeNull();
    },
  );

  it("rejects a zero factory address", () => {
    expect(
      parsePendingLaunch(JSON.stringify({ ...pending, factory: `0x${"0".repeat(40)}` }), creator),
    ).toBeNull();
  });

  it("requires a string credit target instead of accepting regex coercion", () => {
    expect(
      parsePendingLaunch(
        JSON.stringify({ ...pending, draft: { ...pending.draft, targetDailyCreditUsd: 10 } }),
        creator,
      ),
    ).toBeNull();
  });

  it("rejects recovery values whose falsiness would silently substitute the creator", () => {
    for (const recoveryAddress of [0, false, null, ""]) {
      expect(
        parsePendingLaunch(
          JSON.stringify({ ...pending, draft: { ...pending.draft, recoveryAddress } }),
          creator,
        ),
      ).toBeNull();
    }
  });

  it("rejects a draft that no supported factory launch could have created", () => {
    expect(
      parsePendingLaunch(
        JSON.stringify({ ...pending, draft: { ...pending.draft, productionSplitBps: 10000 } }),
        creator,
      ),
    ).toBeNull();
  });

  it("retains a zero-tax launch permitted by the factory", () => {
    const record = { ...pending, draft: { ...pending.draft, cashOutTaxBps: 0 } };
    expect(parsePendingLaunch(JSON.stringify(record), creator)).toEqual(record);
  });

  it("never throws for wrong-shaped nested data or malformed storage", () => {
    for (const draft of [null, [], "text", 1, {}, { name: {} }, { ...pending.draft, name: 1 }]) {
      expect(parsePendingLaunch(JSON.stringify({ ...pending, draft }), creator)).toBeNull();
    }
    expect(parsePendingLaunch("{", creator)).toBeNull();
    expect(parsePendingLaunch(null, creator)).toBeNull();
  });
});
