import { usePayShop } from "@/app/[slug]/components/v6/pay/usePayShop";
import { useShopInventory } from "@/app/[slug]/components/v6/shop/shopLib";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProject721Shop: vi.fn(async () => null) }));
vi.mock("wagmi", () => ({ usePublicClient: () => ({}) }));
vi.mock("@/hooks/useViewedAccount", () => ({ useViewedAccount: () => ({ address: undefined }) }));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getProject721Shop: mocks.getProject721Shop,
}));

it("reads a shop once for the Pay card and the Shop tab together", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => [useShopInventory(1, 4n), usePayShop(1, 4n)] as const, {
    wrapper,
  });
  await waitFor(() => expect(result.current.every((query) => query.isSuccess)).toBe(true));
  expect(mocks.getProject721Shop).toHaveBeenCalledTimes(1);
});
