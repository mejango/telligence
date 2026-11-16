import { getIndexedSuckerGroup } from "@/app/[slug]/getSuckerGroup";
import type { SuckerGroupQuery } from "@/lib/bendystraw/types";
import { indexedGroupStatus, projectIndexMessage } from "@/lib/projectIndexStatus";
import { describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: query }));
const group = (items: unknown[]) =>
  ({ id: "group", projects: { items } }) as NonNullable<SuckerGroupQuery["suckerGroup"]>;

describe("indexed project availability", () => {
  it("keeps failed, absent and incomplete group reads distinct", async () => {
    query.mockRejectedValueOnce(new Error("secret transport details"));
    expect(await getIndexedSuckerGroup("group", 1)).toEqual({ data: null, status: "unavailable" });
    query.mockResolvedValueOnce({ suckerGroup: null });
    expect(await getIndexedSuckerGroup("group", 1)).toEqual({ data: null, status: "missing" });
    query.mockResolvedValueOnce({ suckerGroup: group([]) });
    expect((await getIndexedSuckerGroup("group", 1)).status).toBe("incomplete");
  });

  it("does not label an unchecked group as absent", async () => {
    query.mockClear();
    expect(await getIndexedSuckerGroup("", 1)).toEqual({ data: null, status: "not-checked" });
    expect(query).not.toHaveBeenCalled();
  });

  it("does not mistake a group omitting the requested project for complete data", () => {
    expect(indexedGroupStatus(group([{ projectId: 2, chainId: 1, version: 6 }]), 1, 1)).toBe(
      "incomplete",
    );
    expect(indexedGroupStatus(group([{ projectId: 1, chainId: 10, version: 6 }]), 1, 1)).toBe(
      "incomplete",
    );
    expect(indexedGroupStatus(group([{ projectId: 1, chainId: 1, version: 5 }]), 1, 1)).toBe(
      "incomplete",
    );
    expect(indexedGroupStatus(group([{ projectId: 1, chainId: 1, version: 6 }]), 1, 1)).toBe(
      "available",
    );
  });

  it("describes evidence without claiming indexing lag", () => {
    expect(projectIndexMessage({ project: "unavailable", group: "missing" })).toContain(
      "request failed",
    );
    expect(projectIndexMessage({ project: "missing", group: "missing" })).toContain(
      "missing or incomplete",
    );
    expect(projectIndexMessage({ project: "incomplete", group: "available" })).toContain(
      "missing or incomplete",
    );
    expect(projectIndexMessage({ project: "available", group: "available" })).toContain(
      "Freshness has not been verified",
    );
  });
});
