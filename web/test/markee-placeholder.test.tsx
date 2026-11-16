import { render, screen } from "@testing-library/react";
import { type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/getHomepageActivity", () => ({ getHomepageActivityPage: vi.fn() }));
vi.mock("@/app/getHomepageReserves", () => ({ getHomepageReserves: vi.fn() }));
vi.mock("@/app/TopProjectsTable", () => ({ TopProjectsTable: () => null }));
vi.mock("@/app/MarkeeAdvertisement", () => ({
  MarkeeAdvertisement: () => <p>Rent flow</p>,
}));
vi.mock("@/app/HomepageDiscoveryLayout", () => ({ HomepageDiscoveryLayout: () => null }));
vi.mock("@/app/HomepageActivityFeed", () => ({ HomepageActivityFeed: () => null }));
vi.mock("@/app/SecuredReserves", () => ({ SecuredReserves: () => null }));

import { HomepageDiscovery } from "@/app/HomepageDiscovery";

function renderTop(siteUrl: string) {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
  const layout = HomepageDiscovery() as ReactElement<Record<string, ReactElement>>;
  render(layout.props.top);
}

describe("homepage Markee slot", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shows only the placeholder in production", () => {
    renderTop("https://revnet.money");
    expect(screen.getByRole("region", { name: "Markee advertisement" })).toHaveTextContent(
      "Ads coming soon",
    );
    expect(screen.queryByText("Rent flow")).toBeNull();
  });

  it("keeps the Rent flow on the dev host", () => {
    renderTop("https://dev.revnet.money");
    expect(screen.getByText("Rent flow")).toBeInTheDocument();
    expect(screen.queryByText("Ads coming soon")).toBeNull();
  });
});
