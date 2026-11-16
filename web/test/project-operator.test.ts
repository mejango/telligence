import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), profile: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn }));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));
vi.mock("@/lib/profile", () => ({ fetchProfile: mocks.profile }));

import { getProjectOperator } from "@/app/[slug]/getProjectOperator";

const operator = "0xbb96a6d3d251dfda76f96d1650f9cfd53b41c8d1";
const held = {
  permissionHolders: {
    items: [{ operator, permissions: [19], isRevnetOperator: true }],
  },
};

describe("project operator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the operator when the profile service has nothing for its address", async () => {
    mocks.query.mockResolvedValue(held);
    mocks.profile.mockResolvedValue(null);
    await expect(getProjectOperator(6, 8453)).resolves.toEqual({ address: operator });
  });

  it("uses the profile when there is one", async () => {
    const profile = { address: operator, displayName: "artizenendowment.eth" };
    mocks.query.mockResolvedValue(held);
    mocks.profile.mockResolvedValue(profile);
    await expect(getProjectOperator(6, 8453)).resolves.toEqual(profile);
  });

  it("says nobody holds the role only when the indexer lists no operator", async () => {
    mocks.query.mockResolvedValue({ permissionHolders: { items: [] } });
    await expect(getProjectOperator(6, 8453)).resolves.toBeNull();
    expect(mocks.profile).not.toHaveBeenCalled();
  });
});
