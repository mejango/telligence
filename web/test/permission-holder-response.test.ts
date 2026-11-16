import {
  AccountPermissionHoldersOperation,
  PermissionHoldersOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { BENDYSTRAW_QUERY_REGISTRY } from "@/lib/bendystraw/registry.server";
import { describe, expect, it, vi } from "vitest";

// The complete shape returned by the production global-grant query: project 0
// is a permission scope, and its account-query project relation is null.
const holder = {
  chainId: 8453,
  projectId: 0,
  version: 6,
  account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  operator: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  permissions: [1],
  isRevnetOperator: false,
  project: null,
};
const variables = {
  where: { chainId: 8453, version: 6, projectId_in: [0, 3] },
  limit: 3,
  offset: 0,
};

describe.each([AccountPermissionHoldersOperation, PermissionHoldersOperation])(
  "$id response",
  (operation) => {
    it.each([
      { position: "first", projectIds: [0, 3] },
      { position: "later", projectIds: [3, 0] },
      { position: "every position", projectIds: [0, 0, 0] },
    ])(
      "accepts global grants at $position through the actual server contract",
      async ({ projectIds }) => {
        const data = {
          permissionHolders: {
            totalCount: projectIds.length,
            items: projectIds.map((projectId) => ({ ...holder, projectId })),
          },
        };
        vi.mocked(fetch).mockResolvedValue(Response.json({ data }));

        await expect(queryBendystraw(8453, operation, variables)).resolves.toEqual(data);
        expect(fetch).toHaveBeenCalledOnce();
        const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
        expect(request.query).toBe(BENDYSTRAW_QUERY_REGISTRY[operation.id].query);
        expect(request.variables).toEqual(variables);
      },
    );

    it("retains strict chain, version and nonnegative integer project identities", () => {
      for (const invalid of [
        { projectId: -1 },
        { projectId: 0.5 },
        { projectId: "0" },
        { projectId: undefined },
        { chainId: 0 },
        { chainId: -1 },
        { chainId: 8453.5 },
        { chainId: "8453" },
        { chainId: undefined },
        { version: 0 },
        { version: -1 },
        { version: 6.5 },
        { version: "6" },
        { version: undefined },
      ]) {
        for (const items of [
          [
            { ...holder, ...invalid },
            { ...holder, projectId: 3 },
          ],
          [
            { ...holder, projectId: 3 },
            { ...holder, ...invalid },
          ],
        ]) {
          expect(operation.validateData({ permissionHolders: { totalCount: 2, items } })).toBe(
            false,
          );
        }
      }
    });

    it("retains the registered document's selected-field and nested-shape checks", async () => {
      for (const field of ["account", "operator", "permissions", "isRevnetOperator"]) {
        const incomplete: Record<string, unknown> = { ...holder, projectId: 3 };
        delete incomplete[field];
        vi.mocked(fetch).mockResolvedValue(
          Response.json({ data: { permissionHolders: { totalCount: 1, items: [incomplete] } } }),
        );
        await expect(queryBendystraw(8453, operation, variables)).rejects.toThrow(
          "returned invalid data",
        );
      }
      if (operation === AccountPermissionHoldersOperation) {
        vi.mocked(fetch).mockResolvedValue(
          Response.json({
            data: {
              permissionHolders: {
                totalCount: 1,
                items: [{ ...holder, projectId: 3, project: { name: "Missing handle" } }],
              },
            },
          }),
        );
        await expect(queryBendystraw(8453, operation, variables)).rejects.toThrow(
          "returned invalid data",
        );
      }
    });
  },
);
