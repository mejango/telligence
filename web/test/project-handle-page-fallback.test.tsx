import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extrasTab: vi.fn(() => null),
  getOperator: vi.fn(),
  getProject: vi.fn(),
  getRulesets: vi.fn(),
  getSuckerGroup: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  operatorTab: vi.fn(() => null),
  overviewTab: vi.fn(() => null),
  ownersTab: vi.fn(() => null),
  resolveRoute: vi.fn(),
  shopTab: vi.fn(() => null),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/[slug]/resolveProjectRoute.server", () => ({
  resolveProjectRoute: mocks.resolveRoute,
}));
vi.mock("@/app/[slug]/getProjectFallback", () => ({
  getProjectWithFallback: mocks.getProject,
}));
vi.mock("@/app/[slug]/getSuckerGroup", () => ({ getSuckerGroup: mocks.getSuckerGroup }));
vi.mock("@/app/[slug]/getProjectOperator", () => ({ getProjectOperator: mocks.getOperator }));
vi.mock("@/app/[slug]/terms/getRulesets", () => ({ getRulesets: mocks.getRulesets }));
vi.mock("@/app/[slug]/components/v6/overview/V6OverviewTab", () => ({
  V6OverviewTab: mocks.overviewTab,
}));
vi.mock("@/app/[slug]/components/v6/owners/V6OwnersTab", () => ({
  V6OwnersTab: mocks.ownersTab,
}));
vi.mock("@/app/[slug]/components/v6/shop/V6ShopTab", () => ({ V6ShopTab: mocks.shopTab }));
vi.mock("@/app/[slug]/components/v6/extras/V6ExtrasTab", () => ({
  V6ExtrasTab: mocks.extrasTab,
}));
vi.mock("@/app/[slug]/components/v6/operator/V6OperatorTab", () => ({
  V6OperatorTab: mocks.operatorTab,
}));

import ExtrasPage from "@/app/[slug]/extras/page";
import OperatorPage from "@/app/[slug]/operator/page";
import OwnersPage from "@/app/[slug]/owners/page";
import OverviewPage from "@/app/[slug]/page";
import ShopPage from "@/app/[slug]/shop/page";

const route = { chainId: 1, projectId: 1n } as const;
const project = {
  projectId: 1,
  suckerGroupId: "missing-group",
  token: "0x000000000000000000000000000000000000EEEe",
  currency: "1",
  decimals: 18,
  tokenSymbol: "ETH",
};
const fallbackProjects = [
  {
    chainId: 1,
    projectId: 1,
    token: project.token,
    currency: project.currency,
    decimals: project.decimals,
    tokenSymbol: project.tokenSymbol,
  },
];

describe("verified handle pages without an indexed sucker group", () => {
  beforeEach(() => {
    mocks.resolveRoute.mockReset().mockResolvedValue(route);
    mocks.getProject.mockReset().mockResolvedValue({ project, degraded: true });
    mocks.getSuckerGroup.mockReset().mockResolvedValue(null);
    mocks.getOperator.mockReset().mockResolvedValue(null);
    mocks.getRulesets.mockReset().mockResolvedValue([]);
    mocks.notFound.mockClear();
  });

  it("renders every nested tab from the single verified project instead of false-404ing", async () => {
    const props = { params: Promise.resolve({ slug: "%40fixture-revnet" }) };
    const directPages = [
      [OwnersPage, mocks.ownersTab],
      [ShopPage, mocks.shopTab],
      [ExtrasPage, mocks.extrasTab],
      [OperatorPage, mocks.operatorTab],
    ] as const;

    for (const [Page, expectedType] of directPages) {
      const element = (await Page(props)) as ReactElement<{ projects: unknown }>;
      expect(element.type).toBe(expectedType);
      expect(element.props.projects).toEqual(fallbackProjects);
    }

    const overview = (await OverviewPage(props)) as ReactElement<{ children: ReactNode }>;
    const overviewTab = Children.toArray(overview.props.children).find(
      (child) => isValidElement(child) && child.type === mocks.overviewTab,
    ) as ReactElement<{ projects: unknown }> | undefined;
    expect(overviewTab?.props.projects).toEqual(fallbackProjects);
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.resolveRoute).toHaveBeenCalledWith("%40fixture-revnet");
  });
});
