import { useUserPermissions } from "@/hooks/useUserPermissions";
import { getJBContractAddress, JBCoreContracts } from "@bananapus/nana-sdk-core";
import { JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VIEWED = "0x1111111111111111111111111111111111111111" as Address;
const CONNECTED = "0x2222222222222222222222222222222222222222" as Address;
const OWNER = "0x3333333333333333333333333333333333333333" as Address;
const OLD_OWNER = "0x4444444444444444444444444444444444444444" as Address;
const PROJECT = 17n;
const mocks = vi.hoisted(() => ({
  viewed: undefined as Address | undefined,
  owner: "" as Address,
  projectId: 17n as bigint | undefined,
  chainId: 8453 as number | undefined,
  clientAvailable: true,
  projectPermissions: 0n,
  wildcardPermissions: 0n,
  readContract: vi.fn(),
  indexedQuery: vi.fn(),
}));

vi.mock("@/hooks/useViewedAccount", () => ({
  useViewedAccount: () => ({
    address: mocks.viewed,
    connectedAddress: CONNECTED,
    isViewAs: true,
  }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => mocks.chainId,
  useJBContractContext: () => ({ projectId: mocks.projectId }),
}));
vi.mock("wagmi", () => ({
  usePublicClient: () => (mocks.clientAvailable ? { readContract: mocks.readContract } : undefined),
}));
vi.mock("@/lib/bendystraw", () => ({
  ProjectWithPermissionsOperation: {},
  useBendystrawQuery: mocks.indexedQuery,
}));

const queryClients: QueryClient[] = [];
function renderPermissions() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  queryClients.push(client);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(useUserPermissions, { wrapper }), client };
}

const bitmap = (...permissions: number[]) =>
  permissions.reduce((value, permission) => value | (1n << BigInt(permission)), 0n);

beforeEach(() => {
  mocks.viewed = VIEWED;
  mocks.owner = OWNER;
  mocks.projectId = PROJECT;
  mocks.chainId = 8453;
  mocks.clientAvailable = true;
  mocks.projectPermissions = 0n;
  mocks.wildcardPermissions = 0n;
  mocks.indexedQuery.mockReturnValue({
    data: {
      project: {
        permissionHolders: {
          items: [
            {
              operator: VIEWED,
              account: OLD_OWNER,
              permissions: [JBPermissionIdsV6.SET_PROJECT_URI],
            },
          ],
        },
      },
    },
    isLoading: false,
  });
  mocks.readContract.mockImplementation(async ({ functionName, args }) => {
    if (functionName === "ownerOf") return mocks.owner;
    if (args[1] === OLD_OWNER) return bitmap(JBPermissionIdsV6.SET_PROJECT_URI);
    return args[2] === 0n ? mocks.wildcardPermissions : mocks.projectPermissions;
  });
});

afterEach(() => {
  queryClients.splice(0).forEach((client) => client.clear());
});

describe("live viewed-account project permissions", () => {
  it("binds grants to the current owner instead of a stale indexed granting account", async () => {
    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission("SET_PROJECT_URI")).toBe(false);
    expect(result.current.permissions).toEqual([]);
    expect(mocks.indexedQuery).not.toHaveBeenCalled();
    expect(mocks.readContract).toHaveBeenCalledTimes(3);
    expect(mocks.readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: getJBContractAddress(JBCoreContracts.JBProjects, 6, 8453),
        functionName: "ownerOf",
        args: [PROJECT],
      }),
    );
    for (const scope of [PROJECT, 0n]) {
      expect(mocks.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: getJBContractAddress(JBCoreContracts.JBPermissions, 6, 8453),
          functionName: "permissionsOf",
          args: [VIEWED, OWNER, scope],
        }),
      );
    }
  });

  it("grants the live owner every known permission without reading grant bitmaps", async () => {
    mocks.viewed = OWNER;
    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.permissions).toEqual(Object.values(JBPermissionIdsV6));
    expect(result.current.hasPermission("SET_PROJECT_URI")).toBe(true);
    expect(mocks.readContract).toHaveBeenCalledTimes(1);
  });

  it.each(["project", "wildcard"] as const)("honors ROOT in the %s scope", async (scope) => {
    if (scope === "project") mocks.projectPermissions = bitmap(JBPermissionIdsV6.ROOT);
    else mocks.wildcardPermissions = bitmap(JBPermissionIdsV6.ROOT);
    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.permissions).toEqual(Object.values(JBPermissionIdsV6));
    expect(result.current.hasPermission("SET_TOKEN_METADATA")).toBe(true);
  });

  it("combines project and wildcard grants", async () => {
    mocks.projectPermissions = bitmap(JBPermissionIdsV6.SET_PROJECT_URI);
    mocks.wildcardPermissions = bitmap(JBPermissionIdsV6.SET_SPLIT_GROUPS);
    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.permissions).toEqual([
      JBPermissionIdsV6.SET_PROJECT_URI,
      JBPermissionIdsV6.SET_SPLIT_GROUPS,
    ]);
    expect(result.current.hasPermission("SET_SPLIT_GROUPS")).toBe(true);
  });

  it("allows a metadata-only delegate without granting the rest of the operator role", async () => {
    mocks.projectPermissions = bitmap(JBPermissionIdsV6.SET_PROJECT_URI);
    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission("SET_PROJECT_URI")).toBe(true);
    expect(result.current.hasPermission("SET_SPLIT_GROUPS")).toBe(false);
    expect(result.current.hasPermission("ROOT")).toBe(false);
    expect(result.current.permissions).toEqual([JBPermissionIdsV6.SET_PROJECT_URI]);
  });

  it("drops cached permissions after a failed live refetch", async () => {
    mocks.projectPermissions = bitmap(JBPermissionIdsV6.SET_PROJECT_URI);
    const { result, client } = renderPermissions();
    await waitFor(() => expect(result.current.hasPermission("SET_PROJECT_URI")).toBe(true));
    mocks.readContract.mockRejectedValue(new Error("RPC unavailable"));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["live-project-permissions"] });
    });
    await waitFor(() => expect(result.current.permissions).toEqual([]));
    expect(result.current.hasPermission("SET_PROJECT_URI")).toBe(false);
  });

  it("fails closed when one of the required grant scopes cannot be read", async () => {
    mocks.projectPermissions = bitmap(JBPermissionIdsV6.SET_PROJECT_URI);
    const read = mocks.readContract.getMockImplementation()!;
    mocks.readContract.mockImplementation(async (call) => {
      if (call.functionName === "permissionsOf" && call.args[2] === 0n)
        throw new Error("RPC unavailable");
      return read(call);
    });
    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.permissions).toEqual([]);
  });

  it("uses the viewed account and clears its grants when the viewed address changes", async () => {
    mocks.projectPermissions = bitmap(JBPermissionIdsV6.SET_PROJECT_URI);
    const { result, rerender } = renderPermissions();
    await waitFor(() => expect(result.current.hasPermission("SET_PROJECT_URI")).toBe(true));
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: [VIEWED, OWNER, PROJECT] }),
    );
    mocks.projectPermissions = 0n;
    mocks.viewed = CONNECTED;
    rerender();
    expect(result.current.hasPermission("SET_PROJECT_URI")).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: [CONNECTED, OWNER, PROJECT] }),
    );
    expect(result.current.permissions).toEqual([]);
  });

  it.each(["account", "chain", "project", "client"])("does not read without a %s", (missing) => {
    if (missing === "account") mocks.viewed = undefined;
    if (missing === "chain") mocks.chainId = undefined;
    if (missing === "project") mocks.projectId = undefined;
    if (missing === "client") mocks.clientAvailable = false;
    const { result } = renderPermissions();
    expect(result.current.permissions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mocks.readContract).not.toHaveBeenCalled();
  });
});
