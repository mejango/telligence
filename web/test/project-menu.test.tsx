import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  segment: null as string | null,
  slug: "base:42",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: mocks.slug }),
  useSelectedLayoutSegment: () => mocks.segment,
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

  it("names the active overflow section from the current route", () => {
    mocks.segment = "operator";
    mocks.slug = "base:42";
    render(<ProjectMenu />);

    expect(
      screen.getByRole("button", {
        name: "More project sections, current: Operator",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the pretty @handle URL while navigating between project tabs", () => {
    mocks.segment = null;
    mocks.slug = "@design.juicebox";
    render(<ProjectMenu />);

    const terms = screen.getByRole("link", { name: "Terms" });
    expect(terms).toHaveAttribute("href", "/@design.juicebox/terms");
    expect(terms).toHaveAttribute("data-project-navigation", "document");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/@design.juicebox?view=overview",
    );
    expect(screen.getByRole("link", { name: "Latest" })).toHaveAttribute(
      "href",
      "/@design.juicebox",
    );
    fireEvent.click(screen.getByRole("button", { name: "More project sections" }));
    const operator = screen.getByRole("link", { name: "Operator" });
    expect(operator).toHaveAttribute("href", "/@design.juicebox/operator");
    expect(operator).toHaveAttribute("data-project-navigation", "document");
  });

  it("retains client navigation only for immutable numeric project slugs", () => {
    mocks.segment = null;
    mocks.slug = "base:42";
    render(<ProjectMenu />);

    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "data-project-navigation",
      "client",
    );
  });
});
