import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowedChainIds: undefined as readonly number[] | undefined,
  resolveSuckers: vi.fn(),
}));
const current = { peerChainId: 8453, projectId: 42n } as const;
const peer = { peerChainId: 1, projectId: 9n } as const;

vi.mock("@bananapus/nana-sdk-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core")>()),
  resolveSuckers: mocks.resolveSuckers,
}));
vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 8453,
  useJBContractContext: () => ({ projectId: 42n }),
  useJBProject: () => ({
    initialSuckers: [current, peer],
    allowedChainIds: mocks.allowedChainIds,
  }),
}));

import { useSuckers } from "@/lib/nana/suckers";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSuckers(), { wrapper });
}

describe("Telligence chain scope for live sucker groups", () => {
  beforeEach(() => {
    mocks.allowedChainIds = [8453];
    mocks.resolveSuckers.mockResolvedValue([current, peer]);
  });

  it("restricts both indexed seed data and refreshed financial choices to Base", async () => {
    const { result } = setup();
    expect(result.current.data).toEqual([current]);
    await act(async () => {
      await result.current.refetch();
    });
    expect(mocks.resolveSuckers).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([current]);
  });

  it("cannot reuse an unrestricted cached group when the product scope changes", () => {
    mocks.allowedChainIds = undefined;
    const { result, rerender } = setup();
    expect(result.current.data).toEqual([peer, current]);
    mocks.allowedChainIds = [8453];
    rerender();
    expect(result.current.data).toEqual([current]);
  });

  it("preserves the original complete group for generic providers", async () => {
    mocks.allowedChainIds = undefined;
    const { result } = setup();
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toEqual([peer, current]);
  });
});
