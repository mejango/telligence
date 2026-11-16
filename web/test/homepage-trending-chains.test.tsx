import { render, screen, within } from "@testing-library/react";
import { type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), group: vi.fn() }));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));
vi.mock("@/app/[slug]/getSuckerGroup", () => ({ getSuckerGroup: mocks.group }));
vi.mock("@/lib/projectMetadataFill.server", () => ({
  fillIndexedMetadata: async (rows: unknown[]) => rows,
}));
vi.mock("@/lib/issuanceFingerprint.server", () => ({ getIssuanceFingerprint: async () => [] }));
vi.mock("@/app/getHomepageActivity", () => ({ getHomepageActivityPage: vi.fn() }));
vi.mock("@/app/getHomepageReserves", () => ({ getHomepageReserves: vi.fn() }));
vi.mock("@/app/TopProjectsTable", () => ({ TopProjectsTable: () => null }));
vi.mock("@/app/MarkeeAdvertisement", () => ({ MarkeeAdvertisement: () => null }));
vi.mock("@/app/HomepageDiscoveryLayout", () => ({ HomepageDiscoveryLayout: () => null }));
vi.mock("@/app/HomepageActivityFeed", () => ({ HomepageActivityFeed: () => null }));
vi.mock("@/app/SecuredReserves", () => ({ SecuredReserves: () => null }));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/IpfsImage", () => ({ IpfsImage: () => null }));
vi.mock("@/components/IssuanceFingerprint", () => ({ IssuanceFingerprint: () => null }));
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

import { HomepageDiscovery } from "@/app/HomepageDiscovery";

const project = {
  chainId: 8453,
  projectId: 7,
  version: 6,
  suckerGroupId: "group",
  isRevnet: true,
  name: "Composite revnet",
  trendingPaymentsCount: 22,
  trendingVolume: "311800000000000000",
  decimals: 18,
  tokenSymbol: "ETH",
};

async function renderPanel(key: "trending" | "newProjects") {
  // Resolve the server component at its existing Suspense boundary.
  const layout = HomepageDiscovery() as ReactElement<Record<string, ReactElement>>;
  const section = layout.props[key] as ReactElement<{ children: ReactElement }>;
  const suspense = section.props.children as ReactElement<{ children: ReactElement }>;
  const panel = suspense.props.children as ReactElement & { type: () => Promise<ReactElement> };
  render(await panel.type());
}

describe("homepage composite Trending chain icons", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ projects: { items: [project] } });
    mocks.group.mockReset().mockResolvedValue(null);
  });

  it("shows all supported group chains once without changing representative rank or activity details", async () => {
    mocks.group.mockResolvedValue({
      projects: {
        items: [
          { ...project, chainId: 1, projectId: 12 },
          { ...project, chainId: 10, projectId: 13 },
          { ...project, chainId: 42161, projectId: 14 },
          { ...project, chainId: 8453 },
          { ...project, chainId: 8453, projectId: 15 },
          { ...project, chainId: 99999 },
          { ...project, chainId: 11155111, version: 4 },
          { ...project, chainId: 84532, suckerGroupId: "other" },
        ],
      },
    });
    await renderPanel("trending");
    const row = screen.getByRole("link");
    expect(row).toHaveAttribute("href", "/base:7");
    expect(
      within(row)
        .getAllByRole("img")
        .map((image) => image.getAttribute("aria-label")),
    ).toEqual(["Ethereum", "Base", "Arbitrum", "Optimism"]);
    expect(row).toHaveTextContent("1Composite revnetRecentPayments: 22Volume: 0.3118 ETH");
    expect(mocks.group).toHaveBeenCalledWith("group", 8453, 7);
  });

  it("shows recent volume in USD when the project takes more than one token", async () => {
    mocks.query.mockResolvedValue({
      projects: {
        items: [
          {
            ...project,
            accountingTokenCount: 2,
            trendingVolume: "311800000000020000",
            trendingVolumeUsd: "1234500000000000000000",
          },
        ],
      },
    });
    await renderPanel("trending");
    expect(screen.getByRole("link")).toHaveTextContent("Volume: $1.23k");
  });

  it("keeps the known representative icon when group membership is unavailable", async () => {
    await renderPanel("trending");
    expect(screen.getAllByRole("img").map((image) => image.getAttribute("aria-label"))).toEqual([
      "Base",
    ]);
    expect(screen.getByRole("link")).toHaveTextContent("Composite revnet");
  });

  it("keeps New project rows on their launch chain without requesting composite membership", async () => {
    await renderPanel("newProjects");
    expect(screen.getByRole("img", { name: "Base" })).toBeInTheDocument();
    expect(mocks.group).not.toHaveBeenCalled();
  });
});
