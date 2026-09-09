import { capacityPresentation } from "@/lib/telligence/presentation";
import {
  parseProjectResponse,
  parseProjectSnapshot,
  parseProjectsResponse,
} from "@/lib/telligence/project-data";
import type { ProjectSnapshot } from "@/lib/telligence/types";
import { describe, expect, it } from "vitest";

const project: ProjectSnapshot = {
  id: "base-12",
  chainId: 8453,
  revnetId: "12",
  name: "Public archive",
  purpose: "Make historical research accessible to everyone.",
  workload: "Summarization",
  targetDailyCreditUsd: "10.000000",
  status: "active",
  policyVersion: "1",
  createdAt: "2026-09-09T12:00:00.000Z",
  wrapperAddress: "0x1111111111111111111111111111111111111111",
  vaultAddress: "0x2222222222222222222222222222222222222222",
  creatorAddress: "0x3333333333333333333333333333333333333333",
  capacity: {
    status: "ready",
    dailyCreditUsd: "12.50",
    remainingCreditUsd: "4.10",
    observedAt: "2026-09-09T12:00:00.000Z",
  },
};

describe("public project identity boundary", () => {
  it("rejects a valid project returned for a different route", () => {
    expect(() => parseProjectResponse({ project }, "base-13")).toThrow("requested project");
    expect(parseProjectResponse({ project }, "base-12")).toEqual(project);
  });
  it("accepts an omitted target as null without changing observed credit", () => {
    const { targetDailyCreditUsd: _target, ...withoutTarget } = project;
    for (const input of [withoutTarget, { ...project, targetDailyCreditUsd: null }]) {
      const parsed = parseProjectSnapshot(input);
      expect(parsed.targetDailyCreditUsd).toBeNull();
      expect(parsed.capacity).toEqual(project.capacity);
    }
    expect(Object.hasOwn(withoutTarget, "targetDailyCreditUsd")).toBe(false);
  });
  it.each(["", " ", "0", "0.000000", "01", "1.0000000", 10, false, [], {}])(
    "rejects a supplied target without a canonical positive decimal string: %j",
    (targetDailyCreditUsd) => {
      expect(() => parseProjectSnapshot({ ...project, targetDailyCreditUsd })).toThrow("invalid");
    },
  );
  it.each(["NaN", "-10", "1e3", "1,000", "1000000000", "9".repeat(100)])(
    "rejects malformed or out-of-range target %s",
    (targetDailyCreditUsd) => {
      expect(() => parseProjectSnapshot({ ...project, targetDailyCreditUsd })).toThrow("invalid");
    },
  );
  it("accepts gateway-valid targets and workloads outside the narrower creation defaults", () => {
    expect(
      parseProjectSnapshot({
        ...project,
        targetDailyCreditUsd: "0.000001",
        workload: "a".repeat(1000),
      }).targetDailyCreditUsd,
    ).toBe("0.000001");
    expect(
      parseProjectSnapshot({ ...project, targetDailyCreditUsd: "999999999.999999" })
        .targetDailyCreditUsd,
    ).toBe("999999999.999999");
  });
  it.each(["wrapperAddress", "vaultAddress", "creatorAddress"])(
    "rejects zero %s before funding or building contract links",
    (field) => {
      expect(() => parseProjectSnapshot({ ...project, [field]: `0x${"0".repeat(40)}` })).toThrow(
        "invalid",
      );
    },
  );
  it("rejects duplicate identities and oversized onchain identifiers", () => {
    expect(() => parseProjectsResponse({ projects: [project, project] })).toThrow("duplicate");
    expect(() => parseProjectSnapshot({ ...project, revnetId: (2n ** 256n).toString() })).toThrow(
      "invalid",
    );
  });
});

describe("capacity observation lifecycle", () => {
  it("requires a new provider observation after the UTC credit reset", () => {
    expect(
      capacityPresentation(
        { ...project, capacity: { ...project.capacity, observedAt: "2026-09-09T23:59:59.000Z" } },
        Date.parse("2026-09-10T00:00:01.000Z"),
      ),
    ).toMatchObject({ label: "Checking capacity", daily: "—", remaining: "—", usable: false });
  });
  it("does not display suspended or recovered credit as presently verified capacity", () => {
    for (const status of ["closed", "winddown", "suspended"] as const) {
      expect(
        capacityPresentation({ ...project, status }, Date.parse("2026-09-09T12:01:00.000Z")),
      ).toMatchObject({ daily: "—", remaining: "—", usable: false });
    }
  });
  it("compares microdollar amounts without losing fractional precision", () => {
    expect(
      capacityPresentation(
        {
          ...project,
          capacity: {
            ...project.capacity,
            dailyCreditUsd: "999999999999.000001",
            remainingCreditUsd: "999999999999.000002",
          },
        },
        Date.parse("2026-09-09T12:01:00.000Z"),
      ),
    ).toMatchObject({ label: "Awaiting verification", daily: "—", usable: false });
  });
});
