import { useLiveRevnetOperators } from "@/app/[slug]/components/v6/operator/useLiveRevnetOperators";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

const ETHEREUM_OPERATOR = "0x2222222222222222222222222222222222222222";
const BASE_OPERATOR = "0x3333333333333333333333333333333333333333";
const mocks = vi.hoisted(() => ({ live: vi.fn() }));

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteProjectPermissions: () => ({
    data: [{ chainId: 8453, projectId: 6, operator: BASE_OPERATOR, permissions: [1] }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  publicClientFor: (chainId: number) => ({ chainId }),
  isLiveRevnetOperator: mocks.live,
}));

it("exposes completed chains for display while retaining the all-chain gate for write consumers", async () => {
  let finishBase!: (isCurrent: boolean) => void;
  const base = new Promise<boolean>((resolve) => (finishBase = resolve));
  mocks.live.mockImplementation(
    async (_client: unknown, row: { chainId: number }) => row.chainId === 1 || base,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rows = [
    { chainId: 1, projectId: 1 },
    { chainId: 8453, projectId: 6 },
  ] as const;
  const { result } = renderHook(
    () =>
      useLiveRevnetOperators(rows, {
        chainId: 1,
        projectId: 1,
        address: ETHEREUM_OPERATOR,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );

  await waitFor(() =>
    expect(result.current.discoveredOperatorByChain).toEqual(new Map([[1, ETHEREUM_OPERATOR]])),
  );
  expect(result.current.isLoading).toBe(true);
  expect(result.current.operatorByChain.size).toBe(0);
  expect(mocks.live).toHaveBeenCalledTimes(2);
  expect(mocks.live).toHaveBeenCalledWith({ chainId: 1 }, rows[0], ETHEREUM_OPERATOR);
  expect(mocks.live).toHaveBeenCalledWith({ chainId: 8453 }, rows[1], BASE_OPERATOR);

  await act(async () => finishBase(true));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const complete = new Map([
    [1, ETHEREUM_OPERATOR],
    [8453, BASE_OPERATOR],
  ]);
  expect(result.current.operatorByChain).toEqual(complete);
  expect(result.current.discoveredOperatorByChain).toEqual(complete);
  expect(mocks.live).toHaveBeenCalledTimes(2);
});
