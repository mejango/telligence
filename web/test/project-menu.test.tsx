import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  segment: null as string | null,
  slug: "base:42",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: mocks.slug }),
  useSelectedLayoutSegment: () => mocks.segment,
  useRouter: () => ({ push: vi.fn() }),
}));

import { ProjectMenu } from "@/app/[slug]/components/ProjectMenu";

describe("ProjectMenu", () => {
  it("reveals and collapses privileged sections inline from More", () => {
    mocks.segment = null;
    mocks.slug = "base:42";
    render(<ProjectMenu />);

    const overview = screen.getByRole("link", { name: "Overview" });
    const terms = screen.getByRole("link", { name: "Terms" });
    const owners = screen.getByRole("link", { name: "Owners" });
    const shop = screen.getByRole("link", { name: "Shop" });
    const activity = screen.getByRole("button", { name: "Latest" });
    expect(activity.querySelector('[data-project-tab-icon="activity"]')).toBeInTheDocument();
    expect(overview.querySelector('[data-project-tab-icon="globe"]')).toBeInTheDocument();
    expect(terms.querySelector('[data-project-tab-icon="stages"]')).toBeInTheDocument();
    expect(owners.querySelector('[data-project-tab-icon="stack"]')).toBeInTheDocument();
    expect(shop.querySelector('[data-project-tab-icon="shop"]')).toBeInTheDocument();
    expect(overview.querySelector("svg")).toHaveAttribute("stroke-linecap", "square");
    expect(overview.querySelector("svg")).toHaveAttribute("stroke-linejoin", "miter");
    expect(screen.queryByRole("link", { name: "Extras" })).not.toBeInTheDocument();

    const more = screen.getByRole("button", { name: "More project sections" });
    expect(more.querySelector('[data-project-tab-icon="more"]')).toBeInTheDocument();
    fireEvent.click(more);
    const extras = screen.getByRole("link", { name: "Extras" });
    const operator = screen.getByRole("link", { name: "Operator" });
    expect(extras).toHaveAttribute("href", "/base:42/extras");
    expect(extras.querySelector('[data-project-tab-icon="extras"]')).toBeInTheDocument();
    expect(extras.querySelector("path")?.getAttribute("d")).not.toContain("C");
    expect(operator).toHaveAttribute("href", "/base:42/operator");
    expect(operator.querySelector('[data-project-tab-icon="operator"]')).toBeInTheDocument();
    expect(operator.querySelector("path")?.getAttribute("d")).not.toContain("C");
    expect(more.querySelector('[data-overflow-orientation="horizontal"]')).toBeInTheDocument();

    fireEvent.click(more);
    expect(screen.queryByRole("link", { name: "Extras" })).not.toBeInTheDocument();
    expect(more.querySelector('[data-overflow-orientation="vertical"]')).toBeInTheDocument();
  });

  it("keeps the pretty @handle URL while navigating between project tabs", () => {
    mocks.segment = null;
    mocks.slug = "@design.juicebox";
    render(<ProjectMenu />);

    const terms = screen.getByRole("link", { name: "Terms" });
    expect(terms).toHaveAttribute("href", "/@design.juicebox/terms");
    expect(terms).toHaveAttribute("data-project-navigation", "client");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/@design.juicebox?view=overview",
    );
    expect(screen.getByRole("button", { name: "Latest" })).toHaveAttribute(
      "data-project-navigation",
      "local",
    );
    fireEvent.click(screen.getByRole("button", { name: "More project sections" }));
    const operator = screen.getByRole("link", { name: "Operator" });
    expect(operator).toHaveAttribute("href", "/@design.juicebox/operator");
    expect(operator).toHaveAttribute("data-project-navigation", "client");
  });

  it("marks only the current section with aria-current", () => {
    mocks.segment = "owners";
    mocks.slug = "base:42";
    const { unmount } = render(<ProjectMenu />);
    expect(screen.getByRole("link", { name: "Owners" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Latest" })).not.toHaveAttribute("aria-current");
    unmount();

    render(<ProjectMenu mobileActivityActive />);
    expect(screen.getByRole("button", { name: "Latest" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Owners" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the current overflow section in the row while More is collapsed", () => {
    mocks.segment = "operator";
    mocks.slug = "base:42";
    render(<ProjectMenu />);
    const more = screen.getByRole("button", { name: "More project sections" });
    expect(more).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Operator" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Extras" })).not.toBeInTheDocument();

    fireEvent.click(more);
    expect(screen.getByRole("link", { name: "Extras" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Operator" })).toHaveAttribute("aria-current", "page");
  });

  it("reveals the overflow tabs beside the others, before More", () => {
    mocks.segment = null;
    mocks.slug = "base:42";
    render(<ProjectMenu />);
    const more = screen.getByRole("button", { name: "More project sections" });
    fireEvent.click(more);

    expect(
      more.compareDocumentPosition(screen.getByRole("link", { name: "Operator" })) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  describe("active tab scrolling", () => {
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 0, height: 0 }) as DOMRect;

    function layOut(activeLeft: number, activeWidth = 80) {
      return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.hasAttribute("data-project-tab-scroll")
          ? rect(16, 358)
          : this.getAttribute("aria-current") === "page"
            ? rect(activeLeft, activeWidth)
            : rect(0, 0);
      });
    }

    it("brings a clipped active tab into the row without moving the page", () => {
      mocks.segment = "shop";
      mocks.slug = "base:42";
      const layout = layOut(495);
      const pageScroll = vi.fn();
      Element.prototype.scrollIntoView = pageScroll;
      const { container } = render(<ProjectMenu />);

      // Centered: tab center 535 minus row center 195, from scrollLeft 0.
      expect(container.querySelector("[data-project-tab-scroll]")!.scrollLeft).toBe(340);
      expect(pageScroll).not.toHaveBeenCalled();
      layout.mockRestore();
    });

    it("leaves the row alone when the active tab is already visible", () => {
      mocks.segment = "terms";
      mocks.slug = "base:42";
      const layout = layOut(100);
      const { container } = render(<ProjectMenu />);

      expect(container.querySelector("[data-project-tab-scroll]")!.scrollLeft).toBe(0);
      layout.mockRestore();
    });
  });

  it("retains client navigation for numeric project slugs", () => {
    mocks.segment = null;
    mocks.slug = "base:42";
    render(<ProjectMenu />);

    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "data-project-navigation",
      "client",
    );
  });
});
