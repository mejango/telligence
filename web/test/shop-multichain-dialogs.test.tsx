import { AddItemsModal } from "@/app/[slug]/components/v6/shop/AddItemsModal";
import { EditItemMediaModal } from "@/app/[slug]/components/v6/shop/EditItemMediaModal";
import type { ShopInventory, ShopTier } from "@/app/[slug]/components/v6/shop/shopLib";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmIsOpen, expectEveryWayOutRefused, findConfirm } from "./support/confirm";
import { groupGateState } from "./support/group-write-gate";

const mocks = vi.hoisted(() => ({
  runBatch: vi.fn(),
  pinDraftItems: vi.fn(),
  addItemsConditions: vi.fn(),
  readMediaEditSource: vi.fn(),
  pinMediaEdits: vi.fn(),
  pinDetailEdits: vi.fn(),
  pinMediaFile: vi.fn(),
  saved: false,
  destinations: [] as unknown[],
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: `0x${"22".repeat(20)}` }),
  usePublicClient: () => undefined,
}));
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
  pinDetailEdits: mocks.pinDetailEdits,
}));
vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({ pinMediaFile: mocks.pinMediaFile }));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));
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
// The shop modals render inline here. The confirm's own dialog shell keeps the
// real native-dialog mechanics.
vi.mock("@/components/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/dialog")>()),
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

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

/** The open confirm's action. */
async function confirmAction(name: string) {
  return within(await findConfirm()).getByRole("button", { name });
}

function mount(kind: "add" | "media", mode?: "details" | "discount" | "remove") {
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
          tier={{ id: 3, discountPercent: 20 } as ShopTier}
          media={{ name: "Original" }}
          mode={mode}
          onClose={vi.fn()}
        />
      )}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  groupGateState.reset();
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

describe("selected-chain shop dialogs", () => {
  it.each([
    { kind: "add" as const, peer: "Add on Base", action: "Add items" },
    { kind: "media" as const, peer: "Update media on Base", action: "Review media update" },
  ])(
    "wallet-action:shop-items keeps $kind off while a selected peer is not linked onchain",
    ({ kind, peer, action }) => {
      groupGateState.unverified = ["8453:91"];
      mount(kind);
      expect(screen.getByRole("button", { name: action })).not.toBeDisabled();
      fireEvent.click(screen.getByRole("checkbox", { name: peer }));
      expect(screen.getByText("A project listed here isn't linked onchain.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: action })).toBeDisabled();
      expect(mocks.addItemsConditions).not.toHaveBeenCalled();
      expect(mocks.readMediaEditSource).not.toHaveBeenCalled();
    },
  );

  it("wallet-action:shop-items submits one add-items call per selected hook with exact per-chain pricing and frozen guards", async () => {
    mount("add");
    fireEvent.click(screen.getByRole("checkbox", { name: "Add on Base" }));
    fireEvent.change(screen.getByLabelText("Item 1 price on Ethereum"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Item 1 price on Base"), { target: { value: "3.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add items" }));
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

  it.each([
    { kind: "add" as const, resume: "Resume saved shop update" },
    { kind: "media" as const, resume: "Resume saved media update" },
  ])(
    "wallet-action:shop-items holds a saved $kind update while inventories load and a group pair is not linked onchain",
    ({ kind, resume }) => {
      groupGateState.unverified = ["1:7"];
      mocks.saved = true;
      mocks.destinations = [];
      mount(kind);
      fireEvent.click(screen.getByRole("button", { name: resume }));
      expect(screen.getByRole("button", { name: resume })).toBeDisabled();
      expect(mocks.runBatch).not.toHaveBeenCalled();
    },
  );

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
    await screen.findByText("Network result unknown");
    expect(screen.getByRole("checkbox", { name: "Add on Base" })).toBeDisabled();
    // The failed send leaves the frozen batch in the confirm to send again.
    fireEvent.click(await confirmAction("Try again"));
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

  it("wallet-action:shop-items requires an explicit peer tier and preserves collection/resolver settings in media writes", async () => {
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

  it("wallet-action:shop-items sets a reviewed discount, refusing one a chain can only lower", async () => {
    mocks.readMediaEditSource.mockImplementation(async (_client, destination, tierId) => ({
      destination,
      tierId,
      discountPercent: 20,
      cantIncreaseDiscountPercent: true,
      metadata: {},
      preconditions: [guard],
    }));
    mount("media", "discount");
    const field = screen.getByLabelText("Discount (% off)");
    expect(field).toHaveValue(10);
    fireEvent.change(field, { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Review discount" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("can only be lowered on Ethereum");
    fireEvent.change(field, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Review discount" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already have this discount");
    fireEvent.change(field, { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Review discount" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledOnce());
    expect(mocks.readMediaEditSource.mock.calls[0][4]).toBe("discount");
    expect(mocks.runBatch.mock.calls[0][0].calls).toMatchObject([
      {
        chainId: 1,
        address: primaryShop.hook,
        functionName: "setDiscountPercentOf",
        args: [3n, 5n],
        recoveryScope: "shop-discount:1:7:3",
        preconditions: [guard],
      },
    ]);
    expect(mocks.pinMediaEdits).not.toHaveBeenCalled();
  });

  it("wallet-action:shop-items saves a new name and description over each chain's own JSON", async () => {
    mocks.pinDetailEdits.mockImplementation(async (sources) =>
      sources.map((source: object) => ({ ...source, encodedIpfsUri: digest, uri: "ipfs://new" })),
    );
    mount("media", "details");
    expect(screen.getByLabelText("Name")).toHaveValue("Original");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Warm" } });
    fireEvent.click(screen.getByRole("button", { name: "Review details update" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledOnce());
    expect(mocks.pinDetailEdits).toHaveBeenCalledWith(expect.any(Array), "Renamed", "Warm");
    expect(mocks.runBatch.mock.calls[0][0]).toMatchObject({
      label: "Edit shop item details",
      context: expect.arrayContaining([{ label: "New name", value: "Renamed" }]),
      calls: [
        { functionName: "setMetadata", args: ["", "", "", "", primaryShop.hook, 3n, digest] },
      ],
    });
  });

  it("wallet-action:shop-items removes only the reviewed item, after the warning", async () => {
    mount("media", "remove");
    expect(screen.getByText(/Buyers can no longer mint this item/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review removal" }));
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledOnce());
    expect(mocks.runBatch.mock.calls[0][0]).toMatchObject({
      label: "Remove shop item",
      scope: "shop-remove:1:7:3",
      calls: [{ chainId: 1, functionName: "adjustTiers", args: [[], [3n]] }],
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

  it("refuses every way out while the items are added, then closes once they land", async () => {
    let finish!: (outcome: unknown) => void;
    mocks.runBatch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount("add");
    fireEvent.change(screen.getByLabelText("Item 1 price on Ethereum"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add items" }));
    const confirm = await findConfirm();
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledOnce());

    expectEveryWayOutRefused(confirm);

    finish({ status: "success", hashes: [] });
    await waitFor(() => expect(confirmIsOpen()).toBe(false));
    expect(mocks.runBatch).toHaveBeenCalledOnce();
  });

  it("refuses every way out while media is replaced, then closes once it lands", async () => {
    let finish!: (outcome: unknown) => void;
    mocks.runBatch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount("media");
    fireEvent.change(screen.getByLabelText("Replacement media URI"), {
      target: { value: "ipfs://replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review media update" }));
    const confirm = await findConfirm();
    await waitFor(() => expect(mocks.runBatch).toHaveBeenCalledOnce());

    expectEveryWayOutRefused(confirm);

    finish({ status: "success", hashes: [] });
    await waitFor(() => expect(confirmIsOpen()).toBe(false));
  });
});
