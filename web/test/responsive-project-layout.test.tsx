import { PROJECT_SECTIONS_ID } from "@/app/[slug]/components/projectSections";
import { ResponsiveProjectLayout } from "@/app/[slug]/components/ResponsiveProjectLayout";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { startTransition, use, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ segment: "terms" as string | null }));
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => route.segment,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/[slug]/components/ProjectMenu", () => ({
  ProjectMenu: () => <nav aria-label="Project tabs" />,
}));

function deferredTab() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function PendingTab({ promise }: { promise: Promise<string> }) {
  return <h2>{use(promise)}</h2>;
}

function PaymentDraft() {
  const [amount, setAmount] = useState("");
  return (
    <label>
      Amount
      <input value={amount} onChange={(event) => setAmount(event.target.value)} />
    </label>
  );
}

beforeEach(() => {
  route.segment = "terms";
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

describe("project skip target", () => {
  it("gives the skip link a focusable target at the section tabs", () => {
    render(
      <ResponsiveProjectLayout sidebar={null} activity={null}>
        <h2>Content</h2>
      </ResponsiveProjectLayout>,
    );
    const target = document.getElementById(PROJECT_SECTIONS_ID);
    expect(target).toHaveAttribute("tabindex", "-1");
    expect(target).toContainElement(screen.getByRole("navigation", { name: "Project tabs" }));
  });
});

describe("project content loading boundary", () => {
  it("shows a local Terms fallback while the sidebar remains usable and mounted", async () => {
    const tab = deferredTab();
    render(
      <ResponsiveProjectLayout sidebar={<PaymentDraft />} activity={<p>Project activity</p>}>
        <PendingTab promise={tab.promise} />
      </ResponsiveProjectLayout>,
    );

    const fallback = screen.getByRole("status", { name: "Loading terms" });
    expect(fallback).toBeVisible();
    expect(fallback.closest("[data-mobile-project-content]")).not.toBeNull();
    expect(screen.getByText("Project activity")).toBeVisible();
    const input = screen.getByRole("textbox", { name: "Amount" });
    expect(input).toBeVisible();
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "12" } });

    await act(async () => tab.resolve("Terms content"));

    expect(await screen.findByRole("heading", { name: "Terms content" })).toBeVisible();
    expect(screen.queryByRole("status", { name: "Loading terms" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Amount" })).toBe(input);
    expect(input).toHaveValue("12");
  });

  it("retains the ready tab and payment draft during a transition to suspended Terms", async () => {
    const tab = deferredTab();
    route.segment = null;
    function Project() {
      const [terms, setTerms] = useState(false);
      return (
        <>
          <button
            onClick={() => {
              route.segment = "terms";
              startTransition(() => setTerms(true));
            }}
          >
            Open Terms
          </button>
          <ResponsiveProjectLayout sidebar={<PaymentDraft />} activity={null}>
            {terms ? <PendingTab promise={tab.promise} /> : <h2>Overview content</h2>}
          </ResponsiveProjectLayout>
        </>
      );
    }
    render(<Project />);
    const overview = screen.getByRole("heading", { name: "Overview content" });
    const input = screen.getByRole("textbox", { name: "Amount" });
    fireEvent.change(input, { target: { value: "12" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Terms" }));
    });

    expect(overview).toBeVisible();
    expect(screen.queryByRole("status", { name: "Loading terms" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Amount" })).toBe(input);
    expect(input).toHaveValue("12");

    await act(async () => tab.resolve("Terms content"));

    expect(await screen.findByRole("heading", { name: "Terms content" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Overview content" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Amount" })).toBe(input);
    expect(input).toHaveValue("12");
  });
});
