import {
  aggregateParticipants,
  participantCountSummary,
} from "@/app/[slug]/components/v6/owners/accounts/participantsAggregate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("owners All-card participants", () => {
  it("uses the complete paginated participant reader", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/owners/accounts/V6AllCard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/useCompleteParticipants/u);
    expect(source).not.toMatch(/PARTICIPANTS_FETCH_LIMIT/u);
  });

  it("aggregates each account across chains", () => {
    const rows = [
      { address: "0xa", chainId: 1, balance: "10" },
      { address: "0xa", chainId: 10, balance: "7" },
      { address: "0xb", chainId: 1, balance: "3" },
    ];
    const aggregated = aggregateParticipants(rows);
    expect(aggregated).toHaveLength(2);
    const a = aggregated.find((p) => p.address === "0xa");
    expect(a?.balance).toBe(17n);
    expect(a?.chains).toEqual([1, 10]);
    const b = aggregated.find((p) => p.address === "0xb");
    expect(b?.balance).toBe(3n);
  });

  it("deduplicates address casing and reports bounded counts as lower bounds", () => {
    const rows = [
      { address: "0xAa", chainId: 1, balance: "10" },
      { address: "0xaa", chainId: 10, balance: "7" },
    ];
    expect(aggregateParticipants(rows)).toHaveLength(1);
    expect(participantCountSummary(rows, 2000)).toEqual({
      count: 1,
      exact: false,
    });
    expect(participantCountSummary(rows, 2)).toEqual({
      count: 1,
      exact: true,
    });
    expect(participantCountSummary(rows, undefined)).toEqual({
      count: 1,
      exact: false,
    });
  });

  it("ranks by the combined balance across chains, not the per-chain page order", () => {
    const rows = [
      { address: "0xbreadfruit", chainId: 1, balance: "140" },
      { address: "0xteam", chainId: 1, balance: "100" },
      { address: "0xteam", chainId: 10, balance: "57" },
      { address: "0xsmall", chainId: 8453, balance: "2" },
    ];
    expect(aggregateParticipants(rows).map((row) => row.address)).toEqual([
      "0xteam",
      "0xbreadfruit",
      "0xsmall",
    ]);
  });

  it("lists an account's chains in the canonical order", () => {
    const rows = [
      { address: "0xa", chainId: 8453, balance: "1" },
      { address: "0xa", chainId: 10, balance: "1" },
      { address: "0xa", chainId: 1, balance: "1" },
    ];
    expect(aggregateParticipants(rows)[0].chains).toEqual([1, 8453, 10]);
  });

  it("skips null rows", () => {
    expect(
      aggregateParticipants([null, { address: "0xa", chainId: 1, balance: "1" }]),
    ).toHaveLength(1);
  });
});
