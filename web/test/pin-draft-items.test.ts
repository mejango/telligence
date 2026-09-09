import { newDraftItem, pinDraftItems, type DraftItem } from "@/components/shop/itemDraft";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pinJsonMetadata: vi.fn(),
  pinMediaFile: vi.fn(),
}));

vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({
  pinJsonMetadata: mocks.pinJsonMetadata,
  pinMediaFile: mocks.pinMediaFile,
}));

function item(overrides: Partial<DraftItem> = {}): DraftItem {
  return { ...newDraftItem(), ...overrides };
}

beforeEach(() => {
  mocks.pinJsonMetadata.mockReset().mockResolvedValue("bafy-json");
  mocks.pinMediaFile.mockReset().mockResolvedValue("bafy-media");
});

describe("pinDraftItems", () => {
  it("leaves already-pinned metadata alone, even when the form has a name", async () => {
    // The pasted document carries its own name, description and media. Pinning a second one
    // from the form's fields would silently replace what was explicitly asked for.
    const [pinned] = await pinDraftItems([
      item({ uri: "ipfs://bafy-existing", name: "Hat", description: "felt" }),
    ]);

    expect(pinned.uri).toBe("ipfs://bafy-existing");
    expect(mocks.pinJsonMetadata).not.toHaveBeenCalled();
  });

  it("wraps a media link in metadata built from the item's fields", async () => {
    const [pinned] = await pinDraftItems([
      item({ name: "Hat", description: "felt", mediaUri: "ipfs://bafy-image" }),
    ]);

    expect(pinned.uri).toBe("ipfs://bafy-json");
    expect(mocks.pinJsonMetadata).toHaveBeenCalledWith({
      name: "Hat",
      description: "felt",
      image: "ipfs://bafy-image",
    });
  });

  it("carries the category's name so the shop can label its shelf", async () => {
    await pinDraftItems(
      [item({ name: "Tee", category: "2" })],
      [
        { id: 1, name: "Hats" },
        { id: 2, name: "Shirts" },
      ],
    );

    expect(mocks.pinJsonMetadata).toHaveBeenCalledWith({ name: "Tee", categoryName: "Shirts" });
  });

  it("pins nothing for an item that composes no metadata", async () => {
    const [pinned] = await pinDraftItems([item({ price: "1" })]);

    expect(pinned.uri).toBe("");
    expect(mocks.pinJsonMetadata).not.toHaveBeenCalled();
  });

  it("refuses to compose metadata with no name to put in it", async () => {
    await expect(pinDraftItems([item({ description: "felt" })])).rejects.toThrow(/enter a name/i);
  });
});
