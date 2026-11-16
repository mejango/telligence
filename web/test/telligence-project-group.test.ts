import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));

let getSuckerGroup: typeof import("@/app/[slug]/getSuckerGroup").getSuckerGroup;

describe("Telligence project group boundary", () => {
  // A fresh module per test: successful group reads are cached for display.
  beforeEach(async () => {
    vi.resetModules();
    ({ getSuckerGroup } = await import("@/app/[slug]/getSuckerGroup"));
  });

  it("only passes Base deployments to project tabs and financial controls", async () => {
    const base = { chainId: 8453, projectId: 42, token: "VVV" };
    const secondBase = { chainId: 8453, projectId: 43, token: "VVV" };
    const group = {
      id: "group",
      projects: { items: [{ chainId: 1, projectId: 42 }, base, secondBase] },
    };
    mocks.query.mockResolvedValue({ suckerGroup: group });

    await expect(getSuckerGroup("group", 8453)).resolves.toEqual({
      ...group,
      projects: { items: [base, secondBase] },
    });
    expect(group.projects.items).toHaveLength(3);
  });

  it("treats an indexer group without a Base deployment as unavailable", async () => {
    mocks.query.mockResolvedValue({
      suckerGroup: { id: "group", projects: { items: [{ chainId: 1, projectId: 42 }] } },
    });
    await expect(getSuckerGroup("group", 8453)).resolves.toBeNull();
  });
});
