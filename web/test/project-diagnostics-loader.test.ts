import { readProjectDiagnostics as loadProjectDiagnostics } from "@/lib/projectDiagnostics.server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sdk: vi.fn(), query: vi.fn(), client: {} }));
vi.mock("@bananapus/nana-sdk-core/v6", () => ({ getProjectDeploymentDiagnostics: mocks.sdk }));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));
vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: () => mocks.client }));
const project = {
  token: "0x000000000000000000000000000000000000eeee",
  decimals: 18,
  currency: 1,
  suckerGroupId: "group",
};
const deployment = { checks: [] };

beforeEach(() => {
  mocks.sdk.mockReset().mockResolvedValue(deployment);
  mocks.query.mockReset();
});

describe("independent project diagnostics", () => {
  it("preserves onchain results when indexed reads fail and does not claim an unchecked group is missing", async () => {
    mocks.query.mockRejectedValue(new Error("private indexer URL"));
    expect(await loadProjectDiagnostics(1, 45n)).toEqual({
      deployment,
      indexer: { project: "unavailable", group: "not-checked" },
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("preserves an available project record when the group read fails", async () => {
    mocks.query
      .mockResolvedValueOnce({ project })
      .mockRejectedValueOnce(new Error("private group error"));
    expect((await loadProjectDiagnostics(1, 45n)).indexer).toEqual({
      project: "available",
      group: "unavailable",
    });
  });

  it("distinguishes absent and incomplete indexed records", async () => {
    mocks.query.mockResolvedValueOnce({ project: null });
    expect((await loadProjectDiagnostics(1, 45n)).indexer).toEqual({
      project: "missing",
      group: "not-checked",
    });
    mocks.query
      .mockResolvedValueOnce({ project: { ...project, token: null } })
      .mockResolvedValueOnce({ suckerGroup: { projects: { items: [] } } });
    expect((await loadProjectDiagnostics(1, 45n)).indexer).toEqual({
      project: "incomplete",
      group: "incomplete",
    });
  });

  it("keeps indexer evidence if RPC fails and passes an explicit operator to the shared SDK", async () => {
    const operator = "0x1111111111111111111111111111111111111111";
    mocks.sdk.mockRejectedValue(new Error("private rpc URL"));
    mocks.query.mockResolvedValueOnce({ project }).mockResolvedValueOnce({
      suckerGroup: { projects: { items: [{ chainId: 1, projectId: 45, version: 6 }] } },
    });
    const result = await loadProjectDiagnostics(1, 45n, operator);
    expect(result).toEqual({
      deployment: null,
      indexer: { project: "available", group: "available" },
    });
    expect(mocks.sdk).toHaveBeenCalledWith(mocks.client, { chainId: 1, projectId: 45n, operator });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
