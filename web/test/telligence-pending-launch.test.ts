import { parsePendingLaunch } from "@/lib/telligence/pending-launch";
import { DEFAULT_COMPUTE_DRAFT } from "@/lib/telligence/types";
import { describe, expect, it } from "vitest";
const creator = "0x1111111111111111111111111111111111111111";
const pending = {
  version: 1,
  creator,
  factory: creator,
  hash: `0x${"ab".repeat(32)}`,
  preparationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  draft: {
    ...DEFAULT_COMPUTE_DRAFT,
    name: "Archive",
    purpose: "Archive public records for anyone to search",
    workload: "Search records",
  },
};
describe("interrupted project registration", () => {
  it("restores the confirmed transaction intent only for its creator", () => {
    expect(parsePendingLaunch(JSON.stringify(pending), creator)).toEqual(pending);
    expect(
      parsePendingLaunch(JSON.stringify(pending), "0x2222222222222222222222222222222222222222"),
    ).toBeNull();
  });
  it.each(["", "10", "123.45"])(
    "resumes blank and existing positive targets without changing transaction intent: %j",
    (targetDailyCreditUsd) => {
      const record = { ...pending, draft: { ...pending.draft, targetDailyCreditUsd } };
      expect(parsePendingLaunch(JSON.stringify(record), creator)).toEqual(record);
    },
  );
  it("normalizes a whitespace-only saved target to the empty draft value", () => {
    const record = { ...pending, draft: { ...pending.draft, targetDailyCreditUsd: " \t\n " } };
    expect(parsePendingLaunch(JSON.stringify(record), creator)).toEqual({
      ...record,
      draft: { ...record.draft, targetDailyCreditUsd: "" },
    });
  });
  it.each([null, false, 0, [], {}])(
    "does not coerce non-string saved targets: %j",
    (targetDailyCreditUsd) => {
      const record = { ...pending, draft: { ...pending.draft, targetDailyCreditUsd } };
      expect(parsePendingLaunch(JSON.stringify(record), creator)).toBeNull();
    },
  );
  it("restores legacy transaction intent with no operator share as zero", () => {
    const { operatorSplitBps: _operatorSplit, ...legacyDraft } = pending.draft;
    const legacy = { ...pending, draft: legacyDraft };
    expect(parsePendingLaunch(JSON.stringify(legacy), creator)).toEqual({
      ...legacy,
      draft: { ...legacyDraft, operatorSplitBps: 0 },
    });
  });
  it.each([0, 1, 2500, 5999])(
    "preserves the chosen operator share %i on resume",
    (operatorSplitBps) => {
      const record = { ...pending, draft: { ...pending.draft, operatorSplitBps } };
      expect(parsePendingLaunch(JSON.stringify(record), creator)).toEqual(record);
    },
  );
  it.each([null, false, "0", "2500", -1, 0.5, 6000, 10000, [], {}])(
    "rejects malformed or excessive operator shares in saved intent: %j",
    (operatorSplitBps) => {
      const record = { ...pending, draft: { ...pending.draft, operatorSplitBps } };
      expect(parsePendingLaunch(JSON.stringify(record), creator)).toBeNull();
    },
  );
  it("rejects malformed storage and never restores secret fields", () => {
    expect(parsePendingLaunch("{", creator)).toBeNull();
    expect(parsePendingLaunch(JSON.stringify({ ...pending, hash: "0xabc" }), creator)).toBeNull();
    expect(
      parsePendingLaunch(
        JSON.stringify({ ...pending, csrfToken: "secret", inferencePrivateKey: "secret" }),
        creator,
      ),
    ).toEqual(pending);
  });
});
