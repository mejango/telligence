import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  segment: null as string | null,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "0x000000000000000000000000000000000000dEaD" }),
  useSelectedLayoutSegment: () => mocks.segment,
}));

import { AccountMenu } from "@/app/account/[id]/components/AccountMenu";

const BASE = "/account/0x000000000000000000000000000000000000dEaD";

describe("AccountMenu", () => {
  it("renders the four account tabs with their routes", () => {
    mocks.segment = null;
    render(<AccountMenu />);

    // Next's Link normalizes the trailing slash of the index route away.
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("href", BASE);
    expect(screen.getByRole("link", { name: "Holdings" })).toHaveAttribute(
      "href",
      `${BASE}/holdings`,
    );
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "href",
      `${BASE}/projects`,
    );
    expect(screen.getByRole("link", { name: "Roles" })).toHaveAttribute("href", `${BASE}/roles`);
  });

  it("marks the tab for the active route segment as selected", () => {
    mocks.segment = null;
    const { unmount } = render(<AccountMenu />);
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Holdings" })).not.toHaveAttribute("aria-current");
    unmount();

    mocks.segment = "holdings";
    render(<AccountMenu />);
    expect(screen.getByRole("link", { name: "Holdings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Activity" })).not.toHaveAttribute("aria-current");
  });
});
