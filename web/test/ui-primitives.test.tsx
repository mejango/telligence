import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LoadingText } from "@/components/ui/LoadingText";
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
import { ErrorNote, TxError } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { stepStatus, TxStep, TxSteps } from "@/components/ui/TxSteps";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

describe("dependency-free UI primitives", () => {
  it("animates loading dots without changing the accessible progress text", () => {
    const { container, rerender } = render(<LoadingText text="Checking payment…" />);
    expect(container.textContent).toBe("Checking payment…");
    expect(container.querySelector(".loading-dots")).toHaveAttribute("aria-hidden", "true");
    rerender(<LoadingText text="Requesting the network-fee quote." active />);
    expect(container.textContent).toBe("Requesting the network-fee quote.");
    expect(container.querySelector(".loading-dots")).toBeTruthy();
    rerender(<LoadingText text="Payment confirmed." />);
    expect(container.querySelector(".loading-dots")).toBeNull();
  });
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

  it("restores opener focus when portal removal prevents native close restoration", async () => {
    const nativeClose = HTMLDialogElement.prototype.close;
    const close = vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      // A removed native dialog does not restore its previously focused element in Chromium.
      const previous = document.activeElement;
      nativeClose.call(this);
      if (previous instanceof HTMLElement) previous.blur();
      (document.activeElement as HTMLElement)?.blur();
    });
    try {
      render(
        <Dialog>
          <DialogTrigger>Open focus check</DialogTrigger>
          <DialogContent>
            <DialogTitle>Focus check</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
      const trigger = screen.getByRole("button", { name: "Open focus check" });
      trigger.focus();
      fireEvent.click(trigger);
      await screen.findByRole("dialog", { name: "Focus check" });
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(trigger).toHaveFocus();
    } finally {
      close.mockRestore();
    }
  });

  it("restores a nested dialog to its opener inside the remaining top layer", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open outer focus check</DialogTrigger>
        <DialogContent>
          <DialogTitle>Outer focus check</DialogTitle>
          <Dialog>
            <DialogTrigger>Open inner focus check</DialogTrigger>
            <DialogContent>
              <DialogTitle>Inner focus check</DialogTitle>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>,
    );
    const outerTrigger = screen.getByRole("button", { name: "Open outer focus check" });
    outerTrigger.focus();
    fireEvent.click(outerTrigger);
    const outer = await screen.findByRole("dialog", { name: "Outer focus check" });
    const innerTrigger = within(outer).getByRole("button", { name: "Open inner focus check" });
    innerTrigger.focus();
    fireEvent.click(innerTrigger);
    await screen.findByRole("dialog", { name: "Inner focus check" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Inner focus check" })).not.toBeInTheDocument(),
    );
    expect(innerTrigger).toHaveFocus();
    expect(outer).toHaveAttribute("open");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(outerTrigger).toHaveFocus();
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

describe("the wallet-prompt queue", () => {
  const steps = [{ title: "Approve" }, { title: "Mint", detail: "Mints the position." }];

  it("marks everything before the active step done and the rest pending", () => {
    render(<TxSteps steps={[...steps, { title: "Stake" }]} activeIndex={1} ariaLabel="Queue" />);

    const items = within(screen.getByLabelText("Queue")).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-state"))).toEqual([
      "complete",
      "active",
      "pending",
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[0]).toHaveTextContent("✓");
    expect(items[1]).toHaveTextContent("Step 2 of 3: Mint");
    expect(items[1]).toHaveTextContent("Mints the position.");
    expect(screen.getByText(/Your wallet will ask for 3 actions/)).toBeInTheDocument();
  });

  it("shows nothing running at -1 and every step done once the flow passes steps.length", () => {
    const { rerender } = render(<TxSteps steps={steps} activeIndex={-1} ariaLabel="Queue" />);
    const states = () =>
      within(screen.getByLabelText("Queue"))
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-state"));
    expect(states()).toEqual(["pending", "pending"]);

    rerender(<TxSteps steps={steps} activeIndex={steps.length} ariaLabel="Queue" />);
    expect(states()).toEqual(["complete", "complete"]);
  });

  it("names a single action, and lets the flow replace the line", () => {
    const { rerender } = render(<TxSteps steps={[{ title: "Burn" }]} activeIndex={-1} />);
    expect(screen.getByText("Your wallet will ask for one action.")).toBeInTheDocument();

    rerender(<TxSteps steps={[{ title: "Burn" }]} activeIndex={-1} intro="One signature." />);
    expect(screen.getByText("One signature.")).toBeInTheDocument();
    expect(screen.queryByText("Your wallet will ask for one action.")).toBeNull();
  });

  it.each([-1, 4])("keeps independent result states when activeIndex is %s", (activeIndex) => {
    render(
      <TxSteps
        steps={[
          { title: "First", status: "Waiting", state: "pending" },
          { title: "Second", status: "Confirmed", state: "complete" },
          { title: "Third", status: "Checking result", state: "active" },
          { title: "Fourth", status: "Reverted", state: "failed" },
        ]}
        activeIndex={activeIndex}
        ariaLabel="Results"
      />,
    );

    const items = within(screen.getByLabelText("Results")).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-state"))).toEqual([
      "pending",
      "complete",
      "active",
      "failed",
    ]);
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[1]).toHaveTextContent("✓");
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[3]).toHaveTextContent("×");
    expect(items[3]).not.toHaveTextContent("✓");
    expect(within(items[3]).getByText("Reverted")).toHaveClass("text-red-700");
  });

  it("keeps a resumable step's own state and body", () => {
    expect(stepStatus(true, true)).toBe("done");
    expect(stepStatus(false, true)).toBe("active");
    expect(stepStatus(false, false)).toBe("pending");
    render(
      <ol>
        <TxStep number={1} total={2} title="Set the ENS record" status="done" />
        <TxStep number={2} total={2} title="Publish the handle" status="active">
          <p>Publishes the reverse claim.</p>
        </TxStep>
      </ol>,
    );

    const [done, active] = screen.getAllByRole("listitem");
    expect(done).toHaveTextContent("✓");
    expect(done).toHaveTextContent("Step 1 of 2");
    expect(done).not.toHaveAttribute("aria-current");
    expect(active).toHaveAttribute("aria-current", "step");
    expect(active).toHaveTextContent("Publish the handle");
    expect(active).toHaveTextContent("Publishes the reverse claim.");
  });
});

describe("one palette in the step file", () => {
  /** The marker colors of a status: its border, fill and text utilities. */
  const colors = (marker: Element) =>
    [...marker.classList].filter((name) => /^(border|bg|text)-(melon|teal|zinc)-/.test(name));

  it("draws a resumable step's markers as the queue draws its own", () => {
    render(
      <>
        <TxSteps
          steps={[{ title: "A" }, { title: "B" }, { title: "C" }]}
          activeIndex={1}
          ariaLabel="Queue"
        />
        <ol aria-label="Resumable">
          <TxStep number={1} total={3} title="A" status="done" />
          <TxStep number={2} total={3} title="B" status="active" />
          <TxStep number={3} total={3} title="C" status="pending" />
        </ol>
      </>,
    );
    const markers = (label: string) =>
      within(screen.getByLabelText(label))
        .getAllByRole("listitem")
        .map((item) => colors(item.querySelector('[aria-hidden="true"]')!));

    expect(markers("Resumable")).toEqual(markers("Queue"));
  });
});

describe("the write error block", () => {
  it("renders nothing without an error, so a flow can pass its state straight through", () => {
    const { container, rerender } = render(<TxError error={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TxError error="" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TxError error={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the error, and wraps unbroken hex inside its container", () => {
    const hex = `0x${"ab".repeat(64)}`;
    render(<TxError error={`Reverted with ${hex}`} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(`Reverted with ${hex}`);
    expect(alert).toHaveClass("wrap-anywhere");
  });

  it("gives the authority cards a compact variant", () => {
    render(<ErrorNote message="The connected account is not the operator." />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The connected account is not the operator.");
    expect(alert).toHaveClass("text-xs", "wrap-anywhere");
  });
});

describe("the progress", () => {
  function Progress(props: Partial<Parameters<typeof TxProgress>[0]>) {
    return (
      <TxProgress
        open
        onClose={vi.fn()}
        title="Confirm burn"
        rows={[
          { label: "Burns", value: "10 ART", strong: true },
          { label: "Holder", value: "0x1111111111111111111111111111111111111111", mono: true },
        ]}
        steps={[{ title: "Burn 10 ART" }]}
        activeIndex={-1}
        start={vi.fn()}
        {...props}
      >
        <p>Supply drops permanently.</p>
      </TxProgress>
    );
  }
  const button = (name: string) => screen.queryByRole("button", { name });

  it("opens the one review once, with no confirm of its own, and keeps the way back", () => {
    const onClose = vi.fn();
    const start = vi.fn();
    const { rerender } = render(<Progress onClose={onClose} start={start} />);

    const dialog = screen.getByRole("dialog", { name: "Confirm burn" }) as HTMLDialogElement;
    expect(dialog).toHaveTextContent("Burns10 ART");
    expect(dialog).toHaveTextContent("Supply drops permanently.");
    expect(start).toHaveBeenCalledOnce();
    expect(button("Cancel")).toBeNull();
    expect(button("Done")).toBeNull();
    rerender(<Progress onClose={onClose} start={start} />);
    expect(start).toHaveBeenCalledOnce();

    fireEvent.click(button("Close")!);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("refuses every way out while busy, and starts nothing", () => {
    const onClose = vi.fn();
    const start = vi.fn();
    render(<Progress busy activeIndex={0} onClose={onClose} start={start} />);
    const dialog = screen.getByRole("dialog", { name: "Confirm burn" }) as HTMLDialogElement;

    expect(button("Close")).toBeDisabled();
    fireEvent.click(button("Close")!);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog);

    expect(onClose).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("collapses to Done once the send is complete", () => {
    const onClose = vi.fn();
    render(<Progress complete status="Tokens burned." onClose={onClose} />);

    expect(screen.getByRole("listitem")).toHaveAttribute("data-state", "complete");
    expect(screen.getByText("Tokens burned.")).toBeInTheDocument();
    fireEvent.click(button("Done")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("waits while it prepares, then opens the review", () => {
    const start = vi.fn();
    const { rerender } = render(
      <Progress preparing status="Reading your balance…" start={start} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Reading your balance…");
    expect(screen.queryByText("Burns")).toBeNull();
    expect(start).not.toHaveBeenCalled();

    rerender(<Progress start={start} />);
    expect(start).toHaveBeenCalledOnce();
  });

  it("shows the send's error with Try again, and renders nothing while closed", () => {
    const start = vi.fn();
    const { rerender } = render(
      <Progress error="The wallet refused the transaction." start={start} />,
    );
    expect(screen.getByText("The wallet refused the transaction.")).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(button("Try again")!);
    expect(start).toHaveBeenCalledOnce();

    rerender(<Progress open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
