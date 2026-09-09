import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runBatch: vi.fn(),
  pinDraftItems: vi.fn(),
  addItemsConditions: vi.fn(),
  readMediaEditSource: vi.fn(),
  pinMediaEdits: vi.fn(),
  pinMediaFile: vi.fn(),
  saved: false,
  destinations: [] as unknown[],
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: `0x${"22".repeat(20)}` }) }));
vi.mock("@/hooks/useMultichainBatch", () => ({
  useMultichainBatch: () => ({
    runBatch: mocks.runBatch,
    getPendingBatch: () =>
      mocks.saved ? { label: "Saved update", total: 2, completed: 1 } : undefined,
  }),
}));
vi.mock("@/app/[slug]/components/v6/shop/useShopDestinations", () => ({
  useShopDestinations: () => ({
    destinations: mocks.destinations,
    unavailable: [],
    isLoading: false,
    clientFor: (chainId: number) => ({ chainId }),
  }),
}));
vi.mock("@/components/shop/itemDraft", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pinDraftItems: mocks.pinDraftItems,
}));
vi.mock("@/app/[slug]/components/v6/shop/shopBatch", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  addItemsConditions: mocks.addItemsConditions,
}));
vi.mock("@/app/[slug]/components/v6/shop/shopMediaEdit", () => ({
  readMediaEditSource: mocks.readMediaEditSource,
  pinMediaEdits: mocks.pinMediaEdits,
}));
vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({ pinMediaFile: mocks.pinMediaFile }));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/TxConfirmDialog", () => ({
  SummaryRow: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
    <div>
      {label}
      {children}
    </div>
  ),
  TxConfirmDialog: ({
    children,
    onConfirm,
    busy,
    error,
  }: {
    children: ReactNode;
    onConfirm: () => void;
    busy?: boolean;
    error?: string;
  }) => (
    <div role="dialog">
      {children}
      <button disabled={busy} onClick={onConfirm}>
        Confirm transaction
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  ),
}));

import { AddItemsModal } from "@/app/[slug]/components/v6/shop/AddItemsModal";
import { EditItemMediaModal } from "@/app/[slug]/components/v6/shop/EditItemMediaModal";
import type { ShopInventory, ShopTier } from "@/app/[slug]/components/v6/shop/shopLib";

const flags = {
  noNewTiersWithReserves: false,
  noNewTiersWithVotes: false,
  noNewTiersWithOwnerMinting: false,
  preventOverspending: false,
  issueTokensForSplits: false,
};
const primaryShop = {
  hook: `0x${"11".repeat(20)}`,
  store: `0x${"55".repeat(20)}`,
  pricing: { currency: 1, decimals: 18, symbol: "ETH" },
  configFlags: flags,
  tiers: [{ id: 3, category: 1 }],
  fixedTierTransferability: false,
} as ShopInventory;
const peerShop = {
  ...primaryShop,
  hook: `0x${"33".repeat(20)}`,
  pricing: { currency: 2, decimals: 6, symbol: "USD" },
  tiers: [{ id: 12, category: 9 }],
} as ShopInventory;
const guard = { address: primaryShop.hook, data: "0x1234", expected: "0x5678" };
const digest = `0x${"77".repeat(32)}`;

function mount(kind: "add" | "media") {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {kind === "add" ? (
        <AddItemsModal
          shop={primaryShop}
          chainId={1}
          projectId={7n}
          projects={[]}
          categories={[]}
          onClose={vi.fn()}
        />
      ) : (
        <EditItemMediaModal
          chainId={1}
          projectId={7n}
          projects={[]}
          tier={{ id: 3 } as ShopTier}
          media={{ name: "Original" }}
          onClose={vi.fn()}
        />
      )}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.saved = false;
  mocks.destinations = [
    { chainId: 1, projectId: 7n, shop: primaryShop },
    { chainId: 8453, projectId: 91n, shop: peerShop },
  ];
  mocks.runBatch.mockResolvedValue({ status: "success", hashes: [] });
  mocks.pinDraftItems.mockImplementation(async (items) => items);
  mocks.addItemsConditions.mockResolvedValue([guard]);
  mocks.readMediaEditSource.mockImplementation(async (_client, destination, tierId) => {
    if (!tierId) throw new Error("Choose an existing item on every selected chain.");
    return { destination, tierId, metadata: { name: "Keep this" }, preconditions: [guard] };
  });
  mocks.pinMediaEdits.mockImplementation(async (sources) =>
    sources.map((source: object) => ({ ...source, encodedIpfsUri: digest, uri: "ipfs://pinned" })),
  );
});

describe("wallet-action:shop-items — selected-chain shop dialogs", () => {
  it("submits one add-items call per selected hook with exact per-chain pricing and frozen guards", async () => {
    mount("add");
    fireEvent.click(screen.getByRole("checkbox", { name: "Add on Base" }));
    fireEvent.change(screen.getByLabelText("Item 1 price on Ethereum"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Item 1 price on Base"), { target: { value: "3.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add items" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm transaction" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledOnce());
    const input = mocks.runBatch.mock.calls[0][0];
    expect(input.scope).toBe("shop-add:1:7");
    expect(input.calls).toHaveLength(2);
    expect(input.calls[0]).toMatchObject({
      chainId: 1,
      address: primaryShop.hook,
      functionName: "adjustTiers",
      preconditions: [guard],
    });
    expect(input.calls[0].args[0][0].price).toBe(2000000000000000000n);
    expect(input.calls[1]).toMatchObject({
      chainId: 8453,
      address: peerShop.hook,
      recoveryScope: "shop-add:8453:91",
    });
    expect(input.calls[1].args[0][0].price).toBe(3250000n);
    expect(input.calls.map((call: { args: unknown[] }) => call.args[1])).toEqual([[], []]);
  });

  it("blocks the whole addition before pinning when a selected peer denies permission", async () => {
    mocks.addItemsConditions.mockRejectedValue(new Error("Peer permission denied"));
    mount("add");
    fireEvent.change(screen.getByLabelText("Item 1 price on Ethereum"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Add on Base" }));
    fireEvent.change(screen.getByLabelText("Item 1 price on Base"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add items" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Peer permission denied");
    expect(mocks.pinDraftItems).not.toHaveBeenCalled();
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it("retains pinned add calldata after uncertain submission and resumes saved updates after reload", async () => {
    mocks.runBatch.mockRejectedValueOnce(new Error("Network result unknown"));
    const view = mount("add");
    fireEvent.change(screen.getByLabelText("Item 1 price on Ethereum"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add items" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm transaction" }));
    await screen.findByText("Network result unknown");
    expect(screen.getByRole("checkbox", { name: "Add on Base" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm transaction" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(2));
    expect(mocks.pinDraftItems).toHaveBeenCalledOnce();
    expect(mocks.runBatch.mock.calls[1][0].calls).toEqual(mocks.runBatch.mock.calls[0][0].calls);
    view.unmount();
    mocks.saved = true;
    mocks.destinations = [];
    mount("add");
    fireEvent.click(screen.getByRole("button", { name: "Resume saved shop update" }));
    await waitFor(() =>
      expect(mocks.runBatch).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: "shop-add:1:7", calls: [] }),
      ),
    );
    expect(mocks.pinDraftItems).toHaveBeenCalledOnce();
  });

  it("requires an explicit peer tier and preserves collection/resolver settings in media writes", async () => {
    mount("media");
    fireEvent.change(screen.getByLabelText("Replacement media URI"), {
      target: { value: "ipfs://replacement" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Update media on Base" }));
    fireEvent.click(screen.getByRole("button", { name: "Review media update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose an existing item");
    expect(mocks.pinMediaEdits).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Item on Base"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Review media update" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm transaction" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledOnce());
    const calls = mocks.runBatch.mock.calls[0][0].calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      chainId: 1,
      address: primaryShop.hook,
      functionName: "setMetadata",
      args: ["", "", "", "", primaryShop.hook, 3n, digest],
      preconditions: [guard],
    });
    expect(calls[1]).toMatchObject({
      chainId: 8453,
      address: peerShop.hook,
      args: ["", "", "", "", peerShop.hook, 12n, digest],
      recoveryScope: "shop-media:8453:91:12",
    });
  });

  it("resumes saved media without rereading a consumed source digest or repinning", async () => {
    mocks.saved = true;
    mocks.destinations = [];
    mount("media");
    fireEvent.click(screen.getByRole("button", { name: "Resume saved media update" }));
    await waitFor(() =>
      expect(mocks.runBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "shop-media:1:7:3",
          label: "Replace shop item media",
          calls: [],
        }),
      ),
    );
    expect(mocks.readMediaEditSource).not.toHaveBeenCalled();
    expect(mocks.pinMediaEdits).not.toHaveBeenCalled();
  });
});
