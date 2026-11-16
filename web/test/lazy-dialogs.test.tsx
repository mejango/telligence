import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Dialogs and modals load when first opened (next/dynamic). These pin that each still opens from
// its trigger, and that hovering the trigger loads it ahead of the click.
const loaded = vi.hoisted(() => ({ detail: vi.fn(), editor: vi.fn() }));

vi.mock("@/hooks/useUserPermissions", () => ({
  useUserPermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@/hooks/useViewedAccount", () => ({ useViewedAccount: () => ({ address: undefined }) }));
vi.mock("wagmi", () => ({ usePublicClient: () => undefined }));
vi.mock("@/lib/nana/project", () => ({
  useJBProjectMetadataContext: () => ({ metadata: { data: { description: "About" } } }),
}));
vi.mock("@/app/[slug]/about/components/RichPreview", () => ({
  RichPreview: ({ source }: { source: string }) => <p>{source}</p>,
}));
vi.mock("@/app/[slug]/about/components/EditMetadataDialog", () => {
  loaded.editor();
  return {
    EditMetadataDialog: () => <button type="button">Edit metadata</button>,
  };
});
vi.mock("@/app/[slug]/components/v6/pay/usePayShop", () => ({
  usePayShopCredits: () => ({ data: undefined }),
}));
vi.mock("@/app/[slug]/components/v6/shop/shopLib", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTierCart: () => ({ count: 0, total: 0n, quantityOf: () => 0, setTierQuantity: () => {} }),
}));
vi.mock("@/app/[slug]/components/v6/shop/TierMediaPreview", () => ({
  TierMediaPreview: () => null,
}));
vi.mock("@/components/EtherscanLink", () => ({ default: () => null }));
vi.mock("@/app/[slug]/components/v6/shop/TierDetailModal", () => {
  loaded.detail();
  return {
    TierDetailModal: ({ onClose }: { onClose: () => void }) => (
      <div role="dialog" aria-label="Item details">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ),
  };
});

import { DescriptionSection } from "@/app/[slug]/about/components/DescriptionSection";
import { InventorySection } from "@/app/[slug]/components/v6/shop/InventorySection";

function withQueries(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: 0 } } })}>
      {children}
    </QueryClientProvider>
  );
}

async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

const tier = {
  id: 1,
  price: 10n ** 18n,
  remaining: 5,
  initial: 5,
  unlimited: false,
  category: 1,
  discountPercent: 0,
  reserveFrequency: 0,
  votingUnits: 0n,
  splitPercent: 0,
  encodedIpfsUri: "0x" as const,
  resolvedUri: "",
  flags: null,
};
const shop = {
  hook: "0x0000000000000000000000000000000000000721" as const,
  store: "0x0000000000000000000000000000000000000722" as const,
  idTarget: "0x0000000000000000000000000000000000000723" as const,
  collection: { name: "Items", symbol: "IT" },
  pricing: { currency: 1, decimals: 18, symbol: "ETH" },
  tiers: [tier],
  configFlags: null,
  fixedTierTransferability: null,
  transfersPaused: null,
  transferPauseByStage: null,
};

describe("lazily loaded dialogs", () => {
  it("shows the metadata editor's trigger for an account that can edit, once it loads", async () => {
    render(withQueries(<DescriptionSection projects={[]} />));
    await settle();
    expect(loaded.editor).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit metadata" })).toBeEnabled();
  });

  it("loads a shop item's details on hover and opens them on click", async () => {
    render(
      withQueries(
        <InventorySection
          shop={shop}
          chainId={1}
          projectId={1n}
          projects={[]}
          mediaById={undefined}
        />,
      ),
    );
    const card = screen.getByRole("button", { name: /View details for/u });
    expect(loaded.detail).not.toHaveBeenCalled();
    fireEvent.pointerEnter(card.parentElement!.parentElement!);
    await settle();
    expect(loaded.detail).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(card);
    expect(await screen.findByRole("dialog", { name: "Item details" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
