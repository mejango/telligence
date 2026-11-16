import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/components/layout/Nav", () => ({ Nav: () => <nav aria-label="Main navigation" /> }));

import NotFound, { metadata } from "@/app/not-found";

function renderAt(pathname: string) {
  route.pathname = pathname;
  return render(<NotFound />);
}

describe("not-found page", () => {
  it("keeps the site nav, one h1 and one link home, and names the page", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Not found");
    expect(screen.getByRole("link", { name: "Return Home" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(metadata.title).toBe("Not found | Revnet");
    // The metadata of the layout that threw would otherwise replace it after hydration.
    expect(document.title).toBe("Not found | Revnet");
  });

  it.each([
    ["/@rev", "No revnet has the handle @rev."],
    ["/%40rev", "No revnet has the handle @rev."],
    ["/account/not-an-account", "No account matches not-an-account."],
    ["/account/not-an-account/roles", "No account matches not-an-account."],
    ["/eth:999", "No revnet at /eth:999."],
    ["/a/b/c", "Nothing at /a/b/c."],
    ["/%E0%A4%A", "No revnet at /%E0%A4%A."],
  ])("says what failed for %s", (pathname, message) => {
    renderAt(pathname);
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
