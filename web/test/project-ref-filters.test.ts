import { payersWhere } from "@/app/[slug]/components/v6/extras/projectPayers";
import { aggregateGrants } from "@/app/[slug]/components/v6/operator/PermissionsCard";
import { permissionHoldersWhere } from "@/app/[slug]/components/v6/operator/operatorLib";
import { projectRefGraphqlInput, projectRefsWhere } from "@/lib/bendystraw/projectRefs";
import { describe, expect, it } from "vitest";

const BASE = 8453;
const ARTIZEN = { chainId: BASE, projectId: 6, version: 6 } as const;

describe("exact Bendystraw project-pair filters", () => {
  it("wraps every project ref in an explicit AND branch", () => {
    expect(projectRefsWhere([ARTIZEN, { chainId: 10, projectId: 42, version: 6 }])).toEqual({
      OR: [
        { AND: [{ chainId: BASE }, { projectId: 6 }, { version: 6 }] },
        { AND: [{ chainId: 10 }, { projectId: 42 }, { version: 6 }] },
      ],
    });
  });

  it("uses the exact-pair builder for permission holders and project payers", () => {
    const rows = [{ chainId: BASE, projectId: 6 }] as const;
    const exact = {
      OR: [{ AND: [{ chainId: BASE }, { projectId: 6 }, { version: 6 }] }],
    };

    expect(permissionHoldersWhere(rows)).toEqual(exact);
    expect(permissionHoldersWhere(rows, { isRevnetOperator: true })).toEqual({
      AND: [exact, { isRevnetOperator: true }],
    });
    expect(payersWhere(rows)).toEqual(exact);
  });

  it("emits the same explicit AND for dynamic GraphQL inputs", () => {
    expect(projectRefGraphqlInput(ARTIZEN)).toBe(
      "{ AND: [{ chainId: 8453 }, { projectId: 6 }, { version: 6 }] }",
    );
  });

  it("rejects invalid protocol identities before constructing a query", () => {
    expect(() => projectRefsWhere([{ chainId: BASE, projectId: 0, version: 6 }])).toThrow(
      "Invalid Bendystraw project reference",
    );
    expect(() => projectRefGraphqlInput({ chainId: BASE, projectId: 6, version: 0 })).toThrow(
      "Invalid Bendystraw project reference",
    );
  });
});

describe("permission grant scoping", () => {
  const OPERATOR = "0x1111111111111111111111111111111111111111";
  const DELEGATE = "0x2222222222222222222222222222222222222222";

  it("drops unrelated projects and coalesces duplicate rows per project", () => {
    const grants = aggregateGrants(
      [
        {
          chainId: BASE,
          projectId: 6,
          account: OPERATOR,
          operator: OPERATOR,
          permissions: [7],
          isRevnetOperator: true,
        },
        {
          chainId: BASE,
          projectId: 6,
          account: OPERATOR,
          operator: OPERATOR,
          permissions: [19, 7],
          isRevnetOperator: true,
        },
        {
          chainId: BASE,
          projectId: 120,
          account: DELEGATE,
          operator: DELEGATE,
          permissions: [1, 2, 3],
          isRevnetOperator: true,
        },
      ],
      [{ chainId: BASE, projectId: 6 }],
    );

    expect(grants).toHaveLength(1);
    expect(grants[0].operator).toBe(OPERATOR);
    expect(grants[0].rows).toHaveLength(1);
    expect(grants[0].union).toEqual([7, 19]);
    expect(grants[0].differs).toBe(false);
  });
});
