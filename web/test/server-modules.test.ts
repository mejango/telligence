import {
  getJBContractAddress,
  RevnetCoreContracts,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emptyProfile: { address: "0xempty", name: "Empty" },
  fetchProfile: vi.fn(),
  request: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: never[]) => unknown) => callback,
}));
vi.mock("@/lib/emptyProfile", () => ({
  getEmptyProfile: () => mocks.emptyProfile,
}));
vi.mock("@/lib/profile", () => ({
  fetchProfile: mocks.fetchProfile,
}));
vi.mock("@/lib/bendystraw/query.server", () => ({
  queryBendystraw: mocks.request,
}));

import {
  getIndexedProjectOperatorAddresses,
  getProjectOperator,
} from "@/app/[slug]/getProjectOperator";
import { Profile } from "@/components/Profile";

describe("server-only profile modules", () => {
  beforeEach(() => {
    mocks.fetchProfile.mockReset();
    mocks.request.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("renders the deterministic empty profile while the fetched profile resolves", async () => {
    const profile = { address: "0xoperator", name: "Operator" };
    const children = vi.fn((value) => value.name);
    mocks.fetchProfile.mockResolvedValue(profile);

    const element = await Profile({ address: "0xoperator", children });

    expect(element.props.fallback).toBe("Empty");
    expect(element.props.children).toBe("Operator");
    expect(mocks.fetchProfile).toHaveBeenCalledWith("0xoperator");
  });

  it("resolves the indexed operator address to its profile", async () => {
    const operator = "0x1111111111111111111111111111111111111111";
    const profile = { address: operator, name: "Operator" };
    mocks.request.mockResolvedValue({
      permissionHolders: {
        items: [{ operator, permissions: [1] }],
        totalCount: 1,
      },
    });
    mocks.fetchProfile.mockResolvedValue(profile);

    await expect(getProjectOperator(7, 8453)).resolves.toEqual(profile);
    expect(mocks.request).toHaveBeenCalledWith(8453, expect.anything(), {
      where: {
        chainId: 8453,
        projectId: 7,
        version: 6,
        account: getJBContractAddress(RevnetCoreContracts.REVOwner, 6, 8453 as JBChainId),
      },
      limit: 64,
      offset: 0,
    });
  });

  it("throws instead of claiming no operator when the indexed lookup is unavailable", async () => {
    mocks.request.mockRejectedValue(new Error("index unavailable"));

    await expect(getProjectOperator(7, 8453)).rejects.toThrow("index unavailable");
    expect(mocks.fetchProfile).not.toHaveBeenCalled();
  });

  it("resolves to null when the indexer answers with no operator", async () => {
    mocks.request.mockResolvedValue({
      permissionHolders: { items: [], totalCount: 0 },
    });

    await expect(getProjectOperator(7, 8453)).resolves.toBeNull();
    expect(mocks.fetchProfile).not.toHaveBeenCalled();
  });

  it("returns every deduplicated REVOwner-account candidate", async () => {
    const stale = "0x2222222222222222222222222222222222222222";
    const current = "0x1111111111111111111111111111111111111111";
    mocks.request.mockResolvedValue({
      permissionHolders: {
        items: [
          { operator: stale, permissions: [1], isRevnetOperator: true },
          { operator: stale, permissions: [], isRevnetOperator: true },
          { operator: current, permissions: [], isRevnetOperator: true },
        ],
        totalCount: 3,
      },
    });

    await expect(getIndexedProjectOperatorAddresses(7, 8453)).resolves.toEqual([stale, current]);
    expect(mocks.request).toHaveBeenCalledWith(8453, expect.anything(), {
      where: {
        chainId: 8453,
        projectId: 7,
        version: 6,
        account: getJBContractAddress(RevnetCoreContracts.REVOwner, 6, 8453 as JBChainId),
      },
      limit: 64,
      offset: 0,
    });
  });
});
