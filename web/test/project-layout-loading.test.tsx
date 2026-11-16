import { Children, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  route: vi.fn(),
  project: vi.fn(),
  group: vi.fn(),
  pageGroup: vi.fn(),
  rulesets: vi.fn(),
  operator: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: reads.notFound }));
vi.mock("next/server", () => ({ connection: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/components/layout/Nav", () => ({ Nav: "nav" }));
vi.mock("@/app/[slug]/canonicalHandle.server", () => ({ lookupCanonicalHandle: vi.fn() }));
vi.mock("@/app/[slug]/resolveProjectRoute.server", () => ({ resolveProjectRoute: reads.route }));
vi.mock("@/app/[slug]/getProjectFallback", () => ({ getProjectWithFallback: reads.project }));
vi.mock("@/app/[slug]/getProject", () => ({ getProject: vi.fn() }));
vi.mock("@/app/[slug]/getSuckerGroup", () => ({
  getIndexedSuckerGroup: reads.group,
  getSuckerGroup: reads.pageGroup,
}));
vi.mock("@/app/[slug]/terms/getRulesets", () => ({ getRulesets: reads.rulesets }));
vi.mock("@/app/[slug]/getProjectOperator", () => ({ getProjectOperator: reads.operator }));
vi.mock("@/app/[slug]/components/ActivityFeed/ActivityFeed", () => ({ ActivityFeed: "activity" }));
vi.mock("@/app/[slug]/components/Header/Header", () => ({ Header: "header" }));
vi.mock("@/app/[slug]/components/NewProjectNotice", () => ({ NewProjectNotice: "notice" }));
vi.mock("@/app/[slug]/components/PayCard/PayCard", () => ({ PayCard: "pay" }));
vi.mock("@/app/[slug]/components/ProjectDiagnostics", () => ({
  ProjectDataNotice: "data-notice",
  ProjectDiagnosticsProvider: "diagnostics",
}));
vi.mock("@/app/[slug]/components/ResponsiveProjectLayout", () => ({
  ResponsiveProjectLayout: "responsive-layout",
}));
vi.mock("@/app/[slug]/components/v6/ShopCartContext", () => ({ ShopCartProvider: "shop-cart" }));
vi.mock("@/app/[slug]/ProjectProviders", () => ({ ProjectProviders: "project-providers" }));
vi.mock("@/app/[slug]/ProjectRouteBoundary", () => ({
  ProjectRouteBoundary: "project-route-boundary",
}));
vi.mock("@/app/[slug]/ProjectRouteContext", () => ({
  ProjectPageBoundary: "project-page-boundary",
}));
vi.mock("@/app/[slug]/components/v6/overview/V6OverviewTab", () => ({ V6OverviewTab: "overview" }));

import SlugLayout from "@/app/[slug]/layout";
import OverviewPage from "@/app/[slug]/page";

const props = { params: Promise.resolve({ slug: "eth:1" }), children: "tab content" };

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [
      child,
      ...elements(child.props.children as ReactNode),
      ...elements(child.props.sidebar as ReactNode),
    ];
  });
}

function renderServer(element: ReactElement) {
  return (
    element.type as (
      props: Record<string, unknown>,
    ) => Promise<ReactElement<Record<string, unknown>>>
  )(element.props as Record<string, unknown>);
}

beforeEach(() => {
  reads.route.mockResolvedValue({ chainId: 1, projectId: 1n });
  reads.project.mockResolvedValue({
    project: {
      projectId: 1,
      name: "Example",
      suckerGroupId: "group",
      isRevnet: true,
      token: "0x000000000000000000000000000000000000EEEe",
      decimals: 18,
    },
    degraded: false,
    indexStatus: "available",
  });
  reads.group.mockResolvedValue({
    data: { id: "group", projects: { items: [{ chainId: 1, projectId: 1, version: 6 }] } },
    status: "available",
  });
  reads.rulesets.mockResolvedValue([]);
  reads.pageGroup.mockResolvedValue({
    id: "group",
    projects: { items: [{ chainId: 1, projectId: 1, version: 6 }] },
  });
  reads.operator.mockResolvedValue(null);
});

describe("project layout resolution", () => {
  it("finishes route and project existence checks before preparing secondary content", async () => {
    reads.route.mockResolvedValueOnce(null);
    await expect(SlugLayout(props)).rejects.toThrow("not found");
    expect(reads.project).not.toHaveBeenCalled();
    expect(reads.group).not.toHaveBeenCalled();

    reads.project.mockResolvedValueOnce(null);
    await expect(SlugLayout(props)).rejects.toThrow("not found");
    expect(reads.group).not.toHaveBeenCalled();
  });

  it("propagates unavailable existence evidence without declaring the project missing", async () => {
    reads.project.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(SlugLayout(props)).rejects.toThrow("RPC unavailable");
    expect(reads.notFound).not.toHaveBeenCalled();
    expect(reads.group).not.toHaveBeenCalled();
  });

  it("binds every project provider to the same verified route as its child page", async () => {
    const route = {
      chainId: 1,
      projectId: 1n,
      verifiedOperator: `0x${"a".repeat(40)}`,
      checkedAt: 1234,
    };
    reads.route.mockResolvedValue(route);
    const shell = await SlugLayout(props);
    const content = await renderServer(shell.props.children);
    const boundary = elements(content).find((element) => element.type === "project-route-boundary");
    expect(boundary?.props.slug).toBe("eth:1");
    expect(boundary?.props.snapshot).toEqual({
      chainId: 1,
      projectId: "1",
      authority: route.verifiedOperator,
      checkedAt: 1234,
    });
    expect(
      elements(boundary?.props.children as ReactNode).filter(
        (element) => element.type === "project-providers",
      ),
    ).toHaveLength(1);
    const page = await OverviewPage(props);
    expect(page.props.snapshot).toEqual(boundary?.props.snapshot);
    expect(reads.operator).not.toHaveBeenCalled();
  });

  it("renders a live-verified revnet even when its indexed classification lags", async () => {
    reads.route.mockResolvedValue({
      chainId: 1,
      projectId: 1n,
      verifiedOperator: `0x${"a".repeat(40)}`,
      checkedAt: 1234,
    });
    reads.project.mockResolvedValue({
      project: { projectId: 1, name: "Example", suckerGroupId: "group", isRevnet: false },
      degraded: false,
      indexStatus: "available",
    });
    const shell = await SlugLayout(props);
    const content = await renderServer(shell.props.children);
    const layout = elements(content).find((element) => element.type === "responsive-layout");
    expect(layout?.props.children).toBe("tab content");
    expect(reads.rulesets).toHaveBeenCalledOnce();
  });

  it("returns an identified loading shell before waiting for group and ruleset data", async () => {
    let finishGroup!: (value: unknown) => void;
    reads.group.mockReturnValueOnce(new Promise((resolve) => (finishGroup = resolve)));
    const shell = await SlugLayout(props);
    expect(shell.type).toBe(Suspense);
    expect(shell.props.fallback.props.hint).toEqual({ name: "Example", logoUri: undefined });
    expect(reads.group).not.toHaveBeenCalled();
    const content = renderServer(shell.props.children);
    await vi.waitFor(() => expect(reads.rulesets).toHaveBeenCalledOnce());
    finishGroup({ data: null, status: "unavailable" });
    const rendered = await content;
    const notice = elements(rendered).find((element) => element.type === "data-notice");
    expect(notice?.props.status).toEqual({ project: "available", group: "unavailable" });
    expect(reads.notFound).not.toHaveBeenCalled();
  });

  it("keeps delayed operator and failed start-time reads inside independent boundaries", async () => {
    let failRulesets!: (cause: Error) => void;
    reads.rulesets.mockReturnValueOnce(new Promise((_resolve, reject) => (failRulesets = reject)));
    const operator = new Promise<null>(() => {});
    reads.operator.mockReturnValueOnce(operator);
    const shell = await SlugLayout(props);
    const content = await renderServer(shell.props.children);
    const boundaries = elements(content).filter((element) => element.type === Suspense);
    const headerBoundary = boundaries.find(
      (element) =>
        isValidElement(element.props.children) && element.props.children.type === "header",
    );
    expect(headerBoundary).toBeDefined();
    expect((headerBoundary!.props.fallback as ReactElement<{ hint: unknown }>).props.hint).toEqual({
      name: "Example",
      logoUri: undefined,
    });
    expect(elements(content).find((element) => element.type === "pay")).toBeDefined();
    const startBoundary = boundaries.find(
      (element) =>
        isValidElement(element.props.children) && typeof element.props.children.type === "function",
    );
    expect(startBoundary).toBeDefined();
    const startNotice = renderServer(startBoundary!.props.children as ReactElement);
    failRulesets(new Error("RPC unavailable"));
    const unavailable = await startNotice;
    expect(unavailable.props.role).toBe("status");
    expect(unavailable.props.children).toBe("Start time is unavailable.");
    expect(reads.notFound).not.toHaveBeenCalled();
  });

  it("renders About while the price chart awaits its stage history", async () => {
    let failRulesets!: (cause: Error) => void;
    reads.rulesets.mockReturnValueOnce(new Promise((_resolve, reject) => (failRulesets = reject)));
    const overview = await OverviewPage(props);
    expect(elements(overview).find((element) => element.type === "overview")).toBeDefined();
    expect(reads.rulesets).not.toHaveBeenCalled();
    const chartBoundary = elements(overview).find((element) => element.type === Suspense);
    const chart = renderServer(chartBoundary!.props.children as ReactElement);
    expect(reads.rulesets).toHaveBeenCalledOnce();
    failRulesets(new Error("RPC unavailable"));
    expect((await chart).props.children).toBe("Price history is unavailable.");
    expect(reads.notFound).not.toHaveBeenCalled();
  });
});
