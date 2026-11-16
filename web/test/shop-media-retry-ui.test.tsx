import { V6ShopTab } from "@/app/[slug]/components/v6/shop/V6ShopTab";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  shop: {
    hook: "0x0000000000000000000000000000000000000001",
    tiers: [
      {
        id: 1,
        encodedIpfsUri: `0x${"0".repeat(64)}`,
        resolvedUri: `data:application/json,${encodeURIComponent(JSON.stringify({ name: "Available" }))}`,
      },
      { id: 2, encodedIpfsUri: `0x${"1".repeat(64)}`, resolvedUri: "" },
    ],
  },
}));
vi.mock("wagmi", () => ({ usePublicClient: () => undefined }));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBContractContext: () => ({ projectId: 1n }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/[slug]/ProjectRouteContext", () => ({ useProjectNavigation: () => vi.fn() }));
vi.mock("@/app/[slug]/components/v6/shop/shopLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/shop/shopLib")>()),
  useShopInventory: () => ({ data: state.shop, isLoading: false, isError: false }),
}));
vi.mock("@/app/[slug]/components/v6/shop/InventorySection", () => ({
  InventorySection: ({ mediaById }: { mediaById: Record<number, { name?: string }> }) => (
    <div>
      <span>{mediaById[1]?.name ?? "Item #1"}</span>
      <span>{mediaById[2]?.name ?? "Item #2"}</span>
      <button type="button">Add to cart</button>
    </div>
  ),
}));
vi.mock("@/app/[slug]/components/v6/shop/CustomersSection", () => ({
  CustomersSection: () => null,
}));

let client: QueryClient | undefined;
afterEach(() => client?.clear());

it("keeps inventory usable and retries only unavailable details without a reload", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const fetcher = vi.fn().mockRejectedValue(new Error("gateway unavailable"));
  vi.stubGlobal("fetch", fetcher);
  render(
    <QueryClientProvider client={client}>
      <V6ShopTab projects={[]} />
    </QueryClientProvider>,
  );
  const retry = await screen.findByRole("button", { name: "Retry details" });
  expect(screen.getByText("Available")).toBeVisible();
  expect(screen.getByText("Item #2")).toBeVisible();
  expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled();
  let recover!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    recover = resolve;
  });
  fetcher.mockReturnValue(pending);
  fireEvent.click(retry);
  expect(await screen.findByRole("button", { name: "Retrying details…" })).toBeDisabled();
  await act(async () => {
    recover({ ok: true, json: async () => ({ name: "Recovered" }) });
  });
  expect(await screen.findByText("Recovered")).toBeVisible();
  expect(screen.getByText("Available")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Retry details" })).toBeNull();
});
