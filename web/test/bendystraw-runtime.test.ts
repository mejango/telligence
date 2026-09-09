import { bendystrawNetworkFor } from "@/lib/bendystraw/client";
import { compileBendystrawOperation } from "@/lib/bendystraw/operationContract";
import { describe, expect, it } from "vitest";

describe("shared Bendystraw runtime policy", () => {
  it("routes nested filters through the SDK network resolver", () => {
    expect(
      bendystrawNetworkFor({
        where: { OR: [{ chainId: 1 }, { nested: { chainId_in: [10, 8453] } }] },
      }),
    ).toBe("mainnet");
    expect(bendystrawNetworkFor({ where: { chainId_in: [11155111, 84532] } })).toBe("testnet");
  });

  it("fails closed for mixed or unsupported chain scopes", () => {
    expect(() => bendystrawNetworkFor({ where: { chainId_in: [1, 11155111] } })).toThrow(
      "cannot mix mainnet and testnet",
    );
    expect(() => bendystrawNetworkFor({ where: { chainId: 999_999 } })).toThrow(
      "Unsupported Bendystraw chain ID",
    );
  });

  it("derives bounded variables and recursive response validation from every document", () => {
    const contract = compileBendystrawOperation(`
      query ContractRegression($where: projectFilter!, $limit: Int!) {
        projects(where: $where, limit: $limit) {
          totalCount
          items { chainId projectId version name }
        }
      }
    `);

    expect(contract.operationName).toBe("ContractRegression");
    expect(contract.validateVariables({ where: { version: 6 }, limit: 25 })).toBe(true);
    expect(contract.validateVariables({ where: { version: 6 }, limit: 25, extra: true })).toBe(
      false,
    );
    expect(
      contract.validateData({
        projects: {
          totalCount: 1,
          items: [{ chainId: 8453, projectId: 6, version: 6, name: "Artizen" }],
        },
      }),
    ).toBe(true);
    expect(
      contract.validateData({
        projects: { totalCount: 1, items: [{ chainId: 8453, projectId: 6, version: 6 }] },
      }),
    ).toBe(false);
  });
});
