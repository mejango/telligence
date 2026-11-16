import { ProjectLink } from "@/components/ProjectLink";
import { clearProjectNavigationHints, getProjectNavigationHint } from "@/lib/project-navigation";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ link: vi.fn() }));

vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.link(props);
    return <a href={String(props.href)} />;
  },
}));

type Handlers = Record<string, () => void>;

function renderLink(props: Partial<ComponentProps<typeof ProjectLink>> = {}) {
  render(<ProjectLink href="/eth:1" {...props} />);
  return mocks.link.mock.lastCall![0] as Record<string, unknown> & Handlers;
}

describe("ProjectLink", () => {
  beforeEach(clearProjectNavigationHints);

  it("never prefetches its project route", () => {
    expect(renderLink().prefetch).toBe(false);
  });

  it("keeps a caller from turning prefetching back on", () => {
    expect(renderLink({ prefetch: true } as never).prefetch).toBe(false);
  });

  it("remembers its hint before each way a visitor reaches the project", () => {
    const link = renderLink({
      href: "/base:7",
      projectHint: { name: "Marquee", logoUri: null, ticker: "MARK" },
    });

    for (const handler of ["onPointerEnter", "onPointerDown", "onFocus", "onClick"]) {
      clearProjectNavigationHints();
      link[handler]();
      expect(getProjectNavigationHint("/base:7"), handler).toEqual({
        name: "Marquee",
        logoUri: null,
        tagline: null,
        ticker: "MARK",
      });
    }
  });

  it("links without a hint and still calls the caller handlers", () => {
    const onClick = vi.fn();
    const link = renderLink({ onClick });

    link.onClick();

    expect(onClick).toHaveBeenCalledOnce();
    expect(getProjectNavigationHint("/eth:1")).toBeNull();
  });
});
