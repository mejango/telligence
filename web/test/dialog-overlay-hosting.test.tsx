import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/toaster";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { isBlockedByModalDialog } from "./native-dialog-shim";

/**
 * A dialog opened with `showModal()` inerts every node outside it and paints
 * its backdrop over them, including nodes that are themselves in the top layer.
 * So the floating overlays that used to portal to the body — select popovers,
 * tooltips, the toast viewport — have to be hosted inside the open dialog.
 */
describe("body-level overlays inside an open dialog", () => {
  it("hosts a select popover inside the dialog that owns its trigger", async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Move between chains</DialogTitle>
          <Select>
            <SelectTrigger aria-label="Network">
              <SelectValue placeholder="Choose a network" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ethereum">Ethereum</SelectItem>
              <SelectItem value="optimism">Optimism</SelectItem>
            </SelectContent>
          </Select>
        </DialogContent>
      </Dialog>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Move between chains" });
    fireEvent.click(screen.getByRole("combobox", { name: "Network" }));

    const listbox = await screen.findByRole("listbox");
    expect(listbox.closest("[data-ui-select-portal]")?.parentElement).toBe(dialog);
    expect(isBlockedByModalDialog(listbox)).toBe(false);

    const option = screen.getByRole("option", { name: "Optimism" });
    expect(isBlockedByModalDialog(option)).toBe(false);
    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Network" })).toHaveTextContent("Optimism"),
    );
  });

  it("hosts a tooltip inside the dialog that owns its trigger", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Add stage</DialogTitle>
            <Tooltip>
              <TooltipTrigger>Cut</TooltipTrigger>
              <TooltipContent>How much issuance falls each cycle.</TooltipContent>
            </Tooltip>
          </DialogContent>
        </Dialog>
      </TooltipProvider>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Add stage" });
    fireEvent.focus(screen.getByRole("button", { name: "Cut" }));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.closest("[data-ui-tooltip-portal]")?.parentElement).toBe(dialog);
    expect(isBlockedByModalDialog(tooltip)).toBe(false);
  });

  it("moves the toast viewport onto the open dialog and back when it closes", async () => {
    function Shell() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Toaster />
          <button onClick={() => setOpen(true)}>Open</button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>Edit metadata</DialogTitle>
            </DialogContent>
          </Dialog>
        </>
      );
    }

    render(<Shell />);
    const viewport = () => screen.getByRole("region", { name: "Notifications" });
    await waitFor(() => expect(viewport().parentElement).toBe(document.body));

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit metadata" });
    await waitFor(() => expect(viewport().parentElement).toBe(dialog));

    act(() => {
      toast({ title: "Upload failed" });
    });
    const raised = await screen.findByText("Upload failed");
    expect(isBlockedByModalDialog(raised)).toBe(false);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(viewport().parentElement).toBe(document.body));
  });
});
