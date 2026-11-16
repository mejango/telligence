import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock("@/components/WalletButton", () => ({ WalletButton: () => <button>Sign in</button> }));
vi.mock("@/hooks/ens/useEnsAddress", () => ({
  useEnsAddress: () => ({ data: null, isFetching: false }),
}));

import { Nav } from "@/components/layout/Nav";

function stubViewport(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: phone, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

beforeEach(() => {
  route.pathname = "/";
  stubViewport(false);
});

describe("site navigation", () => {
  it("passes no light foreground down to the panels it contains", () => {
    render(<Nav />);
    expect(screen.getByRole("navigation", { name: "Main navigation" }).className).not.toMatch(
      /\btext-zinc-50\b/u,
    );
  });

  it("skips to a focusable target right after the nav on any page", () => {
    route.pathname = "/create";
    render(<Nav />);
    const skip = screen.getByRole("link", { name: "Skip to content" });
    const target = document.querySelector<HTMLElement>(skip.getAttribute("href")!);
    expect(target).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("navigation", { name: "Main navigation" })).not.toContainElement(
      target,
    );
  });

  it("keeps the guide pages' own target and takes a page's named one", () => {
    route.pathname = "/learn";
    const { unmount } = render(<Nav />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#guide-content",
    );
    unmount();

    route.pathname = "/eth:3";
    render(<Nav skipTo="project-sections" />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#project-sections",
    );
  });

  it("widens the same search field over the logo column while it has focus", () => {
    render(<Nav />);
    const input = screen.getByRole("searchbox");
    const column = input.closest("[data-site-nav-search]")!;
    fireEvent.change(input, { target: { value: "rev" } });
    expect(column.className).not.toContain("col-span-2");

    fireEvent.focus(input);
    expect(column.className).toContain("col-span-2");
    expect(screen.getByRole("searchbox")).toBe(input);
    expect(input).toHaveValue("rev");

    fireEvent.blur(input);
    expect(column.className).not.toContain("col-span-2");
    expect(input).toHaveValue("rev");
  });

  it("focuses the field when the phone's search icon opens it", () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("shortens the search hint at phone width in CSS, with no wait for a width read", () => {
    render(<Nav />);
    const hint = screen.getByText("Search", { selector: "span[aria-hidden]" });
    expect(hint.textContent).toBe("Search revnets");
    expect(within(hint).getByText("revnets").className).toContain("hidden md:inline");
  });
});
