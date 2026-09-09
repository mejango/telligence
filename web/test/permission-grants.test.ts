import { describe, expect, it } from "vitest";

import { aggregateGrants } from "@/app/[slug]/components/v6/operator/PermissionsCard";
import type {
  ChainProjectRow,
  PermissionHolderRow,
} from "@/app/[slug]/components/v6/operator/operatorLib";
import { revnetOwnerAddress } from "@/app/[slug]/components/v6/operator/operatorLib";
import type { JBChainId } from "@bananapus/nana-sdk-core";

// The Permissions card has to answer "which accounts hold which permissions, where" honestly. Two
// things the raw indexed rows don't say: whether the grantor still owns the revnet, and that a
// wildcard (projectId 0) grant is a different grant with a wider blast radius than a scoped one.
const BASE = 8453 as JBChainId;
const OP = "0x3333333333333333333333333333333333333333";
const FORMER = "0x9999999999999999999999999999999999999999";
const ROWS: ChainProjectRow[] = [{ chainId: BASE, projectId: 5 }];
const REV_OWNER = revnetOwnerAddress(BASE)!;

const holder = (
  account: string,
  permissions: number[],
  overrides: Partial<PermissionHolderRow> = {},
): PermissionHolderRow =>
  ({
    chainId: BASE,
    projectId: 5,
    account,
    operator: OP,
    permissions,
    isRevnetOperator: false,
    ...overrides,
  }) as PermissionHolderRow;

describe("aggregateGrants", () => {
  it("has a REVOwner address to check grants against", () => {
    expect(REV_OWNER).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("treats a grant from the current REVOwner as live", () => {
    const [grant] = aggregateGrants([holder(REV_OWNER, [24, 26])], ROWS);
    expect(grant.live).toBe(true);
    expect(grant.union).toEqual([24, 26]);
    expect(grant.wildcard).toBe(false);
  });

  it("flags a grant whose grantor no longer owns the revnet", () => {
    const [grant] = aggregateGrants([holder(FORMER, [24])], ROWS);
    expect(grant.live).toBe(false);
    expect(grant.account).toBe(FORMER);
  });

  // A wildcard grant reaches every project REVOwner holds, so it can't be folded into the project row.
  it("keeps wildcard grants separate from project-scoped ones for the same operator", () => {
    const grants = aggregateGrants(
      [holder(REV_OWNER, [24]), holder(REV_OWNER, [1], { projectId: 0, wildcard: true })],
      ROWS,
    );
    expect(grants).toHaveLength(2);
    expect(grants.find((grant) => grant.wildcard)?.union).toEqual([1]);
    expect(grants.find((grant) => !grant.wildcard)?.union).toEqual([24]);
  });

  // Wildcard rows carry projectId 0, so per-project coverage would always look incomplete for them.
  it("does not call a fully covered wildcard grant chain-divergent", () => {
    const [grant] = aggregateGrants(
      [holder(REV_OWNER, [1], { projectId: 0, wildcard: true })],
      ROWS,
    );
    expect(grant.differs).toBe(false);
  });
});
