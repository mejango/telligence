import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastViewport,
} from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

describe("dependency-free UI primitives", () => {
  it("moves and restores dialog focus and supports Escape and backdrop dismissal", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <button>Open settings</button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Change project settings.</DialogDescription>
          <input aria-label="Project name" />
          <button>Save</button>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Open settings" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    // `showModal()` makes `role="dialog"` and `aria-modal` implicit, and the
    // backdrop is `::backdrop` rather than an element, so there is nothing in
    // the portal but the dialog itself.
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAccessibleDescription("Change project settings.");
    expect(dialog.className).not.toMatch(/animate-in|fade-in|zoom-in|slide-in/);
    expect(dialog.closest("[data-ui-dialog-portal]")?.children).toHaveLength(1);
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(trigger);
    const reopened = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.pointerDown(reopened);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("supports controlled select value, arrow keys, disabled options, and typeahead", async () => {
    function Example() {
      const [value, setValue] = useState("");
      return (
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger aria-label="Network">
            <SelectValue placeholder="Choose a network" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ethereum">Ethereum</SelectItem>
            <SelectItem value="optimism">Optimism</SelectItem>
            <SelectItem value="disabled" disabled>
              Disabled
            </SelectItem>
          </SelectContent>
        </Select>
      );
    }

    render(<Example />);
    const trigger = screen.getByRole("combobox", { name: "Network" });
    expect(trigger).toHaveTextContent("Choose a network");
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeVisible();
    expect(listbox.className).not.toMatch(/animate-in|fade-in|zoom-in|slide-in/);
    expect(screen.getByRole("option", { name: "Disabled" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => expect(trigger).toHaveTextContent("Optimism"));
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(trigger, { key: "e" });
    await waitFor(() => expect(trigger).toHaveTextContent("Ethereum"));
  });

  it("links tooltip content to its trigger and closes it with Escape", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <time>2h ago</time>
          </TooltipTrigger>
          <TooltipContent>January 1</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const trigger = screen.getByText("2h ago");
    fireEvent.focus(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("toggles tooltip content on repeated mobile taps", async () => {
    const matchMedia = vi.fn(() => ({
      matches: true,
      media: "(max-width: 767px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);

    render(
      <Tooltip>
        <TooltipTrigger>Balance details</TooltipTrigger>
        <TooltipContent>All chain balances</TooltipContent>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "Balance details" });
    await waitFor(() => expect(matchMedia).toHaveBeenCalled());

    fireEvent.focus(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("All chain balances");

    fireEvent.pointerLeave(trigger, { pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByRole("tooltip")).toBeVisible();

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("announces and dismisses toasts through an accessible live role", async () => {
    const onOpenChange = vi.fn();
    render(
      <ToastProvider duration={Infinity}>
        <ToastViewport>
          <Toast onOpenChange={onOpenChange}>
            <ToastDescription>Transaction confirmed.</ToastDescription>
            <ToastClose />
          </Toast>
        </ToastViewport>
      </ToastProvider>,
    );

    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Transaction confirmed.");
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("preserves the child element for Button asChild", () => {
    const disabledClick = vi.fn();
    render(
      <>
        <Button asChild variant="outline">
          <a href="https://example.com/project">View project</a>
        </Button>
        <Button asChild disabled>
          <a href="https://example.com/disabled" onClick={disabledClick}>
            Disabled project
          </a>
        </Button>
      </>,
    );
    const link = screen.getByRole("link", { name: "View project" });
    expect(link).toHaveAttribute("href", "https://example.com/project");
    expect(link.className).toContain("border");
    const disabledLink = screen.getByRole("link", { name: "Disabled project" });
    fireEvent.click(disabledLink);
    expect(disabledClick).not.toHaveBeenCalled();
    expect(disabledLink).toHaveAttribute("aria-disabled", "true");
  });

  it("gives inherited outline controls an explicit accessible foreground", () => {
    render(<Button variant="outline">Connect wallet</Button>);

    const button = screen.getByRole("button", { name: "Connect wallet" });
    expect(button.className).toContain("text-zinc-950");
    expect(button.className).toContain("dark:text-zinc-50");
  });
});
