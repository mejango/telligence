import { AddStageDialog } from "@/app/create/form/AddStageDialog";
import { Button } from "@/components/ui/button";
import { FormProvider } from "@/lib/forms";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { validRevnetForm } from "./fixtures/revnet";

describe("creation stage dialog readiness", () => {
  it.each([false, true])(
    "preserves SSR readiness and the caller lock (disabled: %s)",
    async (disabled) => {
      const onOpen = vi.fn();
      const onSave = vi.fn();
      const onRecoverableError = vi.fn();
      const client = new QueryClient();
      const values = { ...validRevnetForm(), stages: [] };
      const stage = (
        <QueryClientProvider client={client}>
          <FormProvider initialValues={values} onSubmit={() => undefined}>
            <AddStageDialog stageIdx={0} onSave={onSave}>
              <Button type="button" onClick={onOpen} disabled={disabled}>
                Add stage
              </Button>
            </AddStageDialog>
          </FormProvider>
        </QueryClientProvider>
      );
      const container = document.createElement("div");
      container.innerHTML = renderToString(stage);
      document.body.append(container);
      let root: Root | undefined;
      try {
        const trigger = screen.getByRole("button", { name: "Add stage" });
        expect(trigger).toBeDisabled();
        trigger.click();
        expect(onOpen).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await act(async () => {
          root = hydrateRoot(container, stage, { onRecoverableError });
        });
        if (disabled) {
          expect(trigger).toBeDisabled();
          fireEvent.click(trigger);
          expect(onOpen).not.toHaveBeenCalled();
          expect(onSave).not.toHaveBeenCalled();
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
          expect(onRecoverableError).not.toHaveBeenCalled();
          return;
        }
        expect(trigger).toBeEnabled();
        fireEvent.click(trigger);
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        const dialog = within(screen.getByRole("dialog"));
        fireEvent.change(dialog.getByRole("combobox", { name: "Issuance currency" }), {
          target: { value: "USD" },
        });
        fireEvent.click(dialog.getByRole("button", { name: "Save stage" }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(onRecoverableError).not.toHaveBeenCalled();
      } finally {
        await act(async () => root?.unmount());
        container.remove();
        client.clear();
      }
    },
  );
});
