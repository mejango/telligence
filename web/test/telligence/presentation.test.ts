import {
  capacityPresentation,
  inspectProjectHref,
  validateComputeDraft,
} from "@/lib/telligence/presentation";
import { DEFAULT_COMPUTE_DRAFT, type ProjectSnapshot } from "@/lib/telligence/types";
import { describe, expect, it } from "vitest";

const project: ProjectSnapshot = {
  id: "base-12",
  chainId: 8453,
  revnetId: "12",
  name: "Public archive",
  purpose: "Make research accessible.",
  workload: "Summarization",
  targetDailyCreditUsd: "10",
  status: "active",
  policyVersion: "1",
  createdAt: "2026-09-09T12:00:00Z",
  wrapperAddress: "0x1111111111111111111111111111111111111111",
  vaultAddress: "0x2222222222222222222222222222222222222222",
  creatorAddress: "0x3333333333333333333333333333333333333333",
  capacity: {
    status: "ready",
    dailyCreditUsd: "12.50",
    remainingCreditUsd: "4.10",
    observedAt: "2026-09-09T12:00:00Z",
  },
};
const now = Date.parse("2026-09-09T12:01:00Z");

describe("compute observations", () => {
  it("presents actual provider credit separately from the fundraising target", () => {
    expect(capacityPresentation(project, now)).toMatchObject({
      label: "Humming",
      daily: "$12.50",
      remaining: "$4.10",
      usable: true,
    });
  });
  it("never turns unknown or stale provider credit into live zeroes", () => {
    expect(
      capacityPresentation(
        { ...project, capacity: { ...project.capacity, observedAt: null } },
        now,
      ),
    ).toMatchObject({ label: "Awaiting verification", daily: "—", remaining: "—", usable: false });
    expect(capacityPresentation(project, now + 6 * 60_000)).toMatchObject({
      label: "Checking capacity",
      daily: "—",
      remaining: "—",
      usable: false,
    });
  });
  it("treats negative, malformed, inconsistent and future observations as unverified", () => {
    for (const capacity of [
      { ...project.capacity, dailyCreditUsd: "NaN" },
      { ...project.capacity, dailyCreditUsd: "-1" },
      { ...project.capacity, remainingCreditUsd: "13" },
      { ...project.capacity, observedAt: "2026-10-01T00:00:00Z" },
    ]) {
      expect(capacityPresentation({ ...project, capacity }, now).usable).toBe(false);
    }
  });
  it("does not call a winding down project humming even with a fresh ready observation", () => {
    expect(capacityPresentation({ ...project, status: "winddown" }, now)).toMatchObject({
      label: "Winding down",
      usable: false,
    });
  });
  it("explains daily exhaustion without implying the endowment is empty", () => {
    expect(
      capacityPresentation(
        {
          ...project,
          capacity: { ...project.capacity, status: "exhausted", remainingCreditUsd: "0" },
        },
        now,
      ),
    ).toMatchObject({
      label: "Back at 00:00 UTC",
      daily: "$12.50",
      remaining: "$0.00",
      usable: false,
    });
  });
  it("constructs inspection links from validated Base project identifiers", () => {
    expect(inspectProjectHref(project.revnetId)).toBe("/base:12");
    expect(() => inspectProjectHref("../create")).toThrow();
  });
});

describe("purpose-first launch validation", () => {
  it("requires a real purpose and workload, and bounds any supplied daily target", () => {
    expect(validateComputeDraft(DEFAULT_COMPUTE_DRAFT)).toMatchObject({
      name: expect.any(String),
      purpose: expect.any(String),
      workload: expect.any(String),
    });
    const draft = {
      ...DEFAULT_COMPUTE_DRAFT,
      name: "Public archive",
      purpose: "Make historical research accessible to everyone.",
      workload: "Summarize archival documents",
    };
    expect(validateComputeDraft(draft)).toEqual({});
    for (const targetDailyCreditUsd of ["-1", "0", "NaN", "1e3", "0.001", "1000001"])
      expect(
        validateComputeDraft({ ...draft, targetDailyCreditUsd }).targetDailyCreditUsd,
      ).toBeTruthy();
  });
  it("starts without a target and accepts a blank target without inventing a budget", () => {
    expect(DEFAULT_COMPUTE_DRAFT.targetDailyCreditUsd).toBe("");
    for (const targetDailyCreditUsd of ["", " \t\n "]) {
      expect(
        validateComputeDraft({
          ...DEFAULT_COMPUTE_DRAFT,
          name: "Public archive",
          purpose: "Make historical research accessible to everyone.",
          workload: "Summarize archival documents",
          targetDailyCreditUsd,
        }),
      ).toEqual({});
    }
  });
  it("defaults the operator share to zero and leaves issued tokens for funders", () => {
    expect(DEFAULT_COMPUTE_DRAFT.operatorSplitBps).toBe(0);
    const draft = {
      ...DEFAULT_COMPUTE_DRAFT,
      name: "Public archive",
      purpose: "Make historical research accessible to everyone.",
      workload: "Summarize archival documents",
    };
    for (const operatorSplitBps of [0, 1, 2500, 5999])
      expect(validateComputeDraft({ ...draft, operatorSplitBps })).toEqual({});
    expect(
      validateComputeDraft({ ...draft, productionSplitBps: 1000, operatorSplitBps: 8999 }),
    ).toEqual({});
    expect(
      validateComputeDraft({ ...draft, productionSplitBps: 6000, operatorSplitBps: 4000 })
        .operatorSplitBps,
    ).toBeTruthy();
  });
  it.each([undefined, null, "2500", false, NaN, Infinity, -1, 1.5, 6000, 10000])(
    "rejects malformed operator shares or shares that consume the funders' remainder: %j",
    (operatorSplitBps) => {
      expect(
        validateComputeDraft({
          ...DEFAULT_COMPUTE_DRAFT,
          operatorSplitBps: operatorSplitBps as number,
        }).operatorSplitBps,
      ).toBeTruthy();
    },
  );
  it("rejects unsupported policy values and malformed recovery addresses", () => {
    expect(
      validateComputeDraft({ ...DEFAULT_COMPUTE_DRAFT, productionSplitBps: 10000 })
        .productionSplitBps,
    ).toBeTruthy();
    expect(
      validateComputeDraft({ ...DEFAULT_COMPUTE_DRAFT, cashOutTaxBps: 10000 }).cashOutTaxBps,
    ).toBeTruthy();
    expect(
      validateComputeDraft({ ...DEFAULT_COMPUTE_DRAFT, recoveryAddress: "0x00" }).recoveryAddress,
    ).toBeTruthy();
  });
});
