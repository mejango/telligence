import { StoreSection } from "@/app/create/form/StoreSection";
import type { RevnetFormData } from "@/app/create/types";
import { newDraftItem } from "@/components/shop/itemDraft";
import { FormProvider } from "@/lib/forms";
import { toJbDraft } from "@/lib/jb-draft";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validRevnetForm } from "./fixtures/revnet";

const pinMediaFile = vi.hoisted(() => vi.fn());
vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({ pinMediaFile }));

beforeEach(() => {
  pinMediaFile.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

function renderStore() {
  const form = validRevnetForm();
  form.store.items = [{ ...newDraftItem(), name: "Clip", price: "1" }];
  const view = render(
    <FormProvider initialValues={form} isInitialValid={false} onSubmit={() => undefined}>
      {({ values }) => (
        <>
          <StoreSection />
          <output data-testid="values">{JSON.stringify(values)}</output>
        </>
      )}
    </FormProvider>,
  );
  const values = () =>
    JSON.parse(screen.getByTestId("values").textContent ?? "{}") as RevnetFormData;
  const choose = (file: File) =>
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
  return { values, choose };
}

describe("shop item media in the create form", () => {
  it("pins media as it is chosen, so an exported draft carries it", async () => {
    pinMediaFile.mockResolvedValue("bafy-clip");
    const { values, choose } = renderStore();
    choose(new File(["x"], "clip.mp4", { type: "video/mp4" }));

    await waitFor(() => expect(values().store.items[0].mediaUri).toBe("ipfs://bafy-clip"));
    expect(values().store.items[0].mediaType).toBe("video/mp4");
    expect(toJbDraft(values()).shop.items[0]).toMatchObject({
      mediaUri: "ipfs://bafy-clip",
      mediaType: "video/mp4",
    });
    expect(screen.getByText("Change media")).toBeInTheDocument();
  });

  it("keeps the file for launch when the pin fails, and drops a pin a newer choice replaced", async () => {
    let finishFirst!: (cid: string) => void;
    pinMediaFile
      .mockImplementationOnce(() => new Promise<string>((resolve) => (finishFirst = resolve)))
      .mockRejectedValueOnce(new Error("offline"));
    const { values, choose } = renderStore();
    choose(new File(["a"], "a.png", { type: "image/png" }));
    choose(new File(["b"], "b.png", { type: "image/png" }));
    finishFirst("bafy-first");

    await waitFor(() => expect(pinMediaFile).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(values().store.items[0].mediaUri).toBe("");
    expect(screen.getByText("Change media")).toBeInTheDocument();
  });
});
