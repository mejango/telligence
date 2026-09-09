import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  expectBoundaryToStayLocal,
  expectContained,
  expectNoBlockingAccessibilityFindings,
  expectSecurityHeaders,
  FIXTURE_ORIGIN,
  installBrowserBoundary,
  retryUntilVisible,
  type BrowserBoundary,
} from "./browser-support";

type FixtureStatus = {
  graphqlOperations: Record<string, number>;
  rpcMethods: Record<string, number>;
  contractFunctions: Record<string, number>;
  multicallBatches: number;
  unknownRequests: Array<{ kind: string; detail: string }>;
};

async function fixtureStatus(request: APIRequestContext): Promise<FixtureStatus> {
  const response = await request.get(`${FIXTURE_ORIGIN}/__fixture/status`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<FixtureStatus>;
}

async function openFixtureProject(page: Page): Promise<BrowserBoundary> {
  const boundary = await installBrowserBoundary(page);
  const response = await page.goto("/base:1", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response);

  await expect(page.getByRole("heading", { level: 1, name: "Fixture Revnet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "FREV", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "$1,250.00 balance" })).toBeVisible();
  await expect(page.getByText("2 owners", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("Created:", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Amount")).toBeEnabled();
  await expect(page.getByLabel("Payment mode")).toHaveValue("pay");
  await expect(page.getByText("USDC", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Base", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("complementary").getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
  return boundary;
}

test("non-Base project routes are unavailable", async ({ page, request }) => {
  const boundary = await installBrowserBoundary(page);
  const response = await page.goto("/eth:1", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response, 404);
  await expect(page.getByRole("heading", { name: "Fixture Revnet" })).toHaveCount(0);
  await expect(page.getByLabel("Amount")).toHaveCount(0);
  expect((await fixtureStatus(request)).unknownRequests).toEqual([]);
  expectBoundaryToStayLocal(boundary);
});

test("fixture project renders its contract-hydrated production shape", async ({
  page,
  request,
}) => {
  const boundary = await openFixtureProject(page);

  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Owners", exact: true })).toBeVisible();
  const tabScroll = page.locator("[data-project-tab-scroll]");
  await expect(tabScroll).toHaveCSS("touch-action", "pan-x");
  await expect(tabScroll).toHaveCSS("overflow-y", "hidden");
  const overviewBox = await page.getByRole("link", { name: "Overview" }).boundingBox();
  const overflowBox = await page
    .getByRole("button", { name: "More project sections" })
    .boundingBox();
  expect(overviewBox).not.toBeNull();
  expect(overflowBox).not.toBeNull();
  expect(
    Math.abs(overviewBox!.y + overviewBox!.height / 2 - (overflowBox!.y + overflowBox!.height / 2)),
  ).toBeLessThanOrEqual(1);
  await expect(page.getByRole("link", { name: "Extras" })).toHaveCount(0);
  await page.getByRole("button", { name: "More project sections" }).click();
  await expect(page.getByRole("link", { name: "Extras" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Operator" })).toBeVisible();
  await expect(page.locator('[data-overflow-orientation="horizontal"]')).toBeVisible();
  await page.getByRole("button", { name: "More project sections" }).click();
  await expect(page.getByRole("link", { name: "Extras" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Latest", exact: true })).toBeVisible();
  await expect(page.getByText("No activity yet")).toBeVisible();

  const viewport = page.viewportSize();
  const sidebarBox = await page.locator('[data-project-layout="sidebar"]').boundingBox();
  const menuBox = await page.locator('[data-project-layout="menu"]').boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  if ((viewport?.width ?? 0) <= 800) {
    expect(menuBox!.y).toBeGreaterThanOrEqual(sidebarBox!.y + sidebarBox!.height);
    expect(Math.abs(menuBox!.x - sidebarBox!.x)).toBeLessThanOrEqual(1);
  } else {
    expect(menuBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width);
  }

  const about = page.getByRole("heading", { name: "About", exact: true });
  if ((viewport?.width ?? 0) <= 800) {
    await expect(about).toBeHidden();
    await expect(page.getByRole("button", { name: "Latest", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Overview" }).click();
  }
  await expect(about).toBeVisible();
  await expect(
    page.getByText(
      "A deterministic, contract-hydrated revnet used to protect the production project shape.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other info" })).toBeVisible();
  await expect(page.getByRole("link", { name: "#1" })).toBeVisible();

  await expectContained(page, [
    "nav",
    "header",
    ...((viewport?.width ?? 0) > 800 ? ["aside"] : []),
    "main",
    "h1",
    "input[aria-label='Amount']",
  ]);

  await expect
    .poll(async () => {
      const status = await fixtureStatus(request);
      return (
        (status.graphqlOperations.Project ?? 0) > 0 &&
        (status.graphqlOperations.SuckerGroup ?? 0) > 0 &&
        (status.graphqlOperations.Participants ?? 0) > 0 &&
        (status.contractFunctions.currentRulesetOf ?? 0) > 0 &&
        (status.contractFunctions.accountingContextsOf ?? 0) > 0 &&
        (status.contractFunctions.tokenOf ?? 0) > 0 &&
        (status.contractFunctions.symbol ?? 0) > 0 &&
        status.multicallBatches > 0
      );
    })
    .toBe(true);
  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  expect(status.graphqlOperations.Project).toBeGreaterThan(0);
  expect(status.graphqlOperations.SuckerGroup).toBeGreaterThan(0);
  expect(status.graphqlOperations.Participants).toBeGreaterThan(0);
  expect(status.contractFunctions.currentRulesetOf).toBeGreaterThan(0);
  expect(status.contractFunctions.accountingContextsOf).toBeGreaterThan(0);
  expect(status.contractFunctions.balanceOf).toBeGreaterThan(0);
  expect(status.contractFunctions.pricePerUnitOf).toBeGreaterThan(0);
  expect(status.contractFunctions.tokenOf).toBeGreaterThan(0);
  expect(status.contractFunctions.symbol).toBeGreaterThan(0);
  expect(status.multicallBatches).toBeGreaterThan(0);

  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("fixture project remains keyboard-usable and accessible", async ({ page, request }) => {
  const boundary = await openFixtureProject(page);
  const amount = page.getByLabel("Amount");

  await amount.focus();
  await page.keyboard.type("0");
  await expect(amount).toHaveValue("0");
  await page.keyboard.press("Tab");
  await expect(page.getByPlaceholder("Add a note")).toBeFocused();

  await expectNoBlockingAccessibilityFindings(page);
  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("project terms stay contract-backed, contained, and accessible", async ({ page, request }) => {
  const boundary = await openFixtureProject(page);

  await expect(page.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/base:1/terms");
  await page.goto("/base:1/terms", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/base:1\/terms$/);
  await expect(page.getByRole("heading", { name: "Token issuance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stages" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Projected .* issuance price in USD over time/ }),
  ).toBeVisible();
  await expect(page.locator("main").getByText(/USD per /)).toBeVisible();
  const headingLeft = await page
    .getByRole("heading", { name: "Token issuance" })
    .evaluate((element) => element.getBoundingClientRect().left);
  const chartLeft = await page
    .getByRole("img", { name: /Projected .* issuance price in USD over time/ })
    .evaluate((element) => element.getBoundingClientRect().left);
  expect(Math.abs(chartLeft - headingLeft)).toBeLessThanOrEqual(1);

  await expect
    .poll(async () => {
      const boxes = await page.locator('[data-slot="issuance-x-tick"]').evaluateAll((ticks) =>
        ticks.map((tick) => {
          const rect = tick.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      );
      return boxes
        .slice(1)
        .reduce(
          (smallestGap, box, index) => Math.min(smallestGap, box.left - boxes[index].right),
          Number.POSITIVE_INFINITY,
        );
    })
    .toBeGreaterThanOrEqual(4);
  await expectContained(page, ["nav", "main"]);
  await expectNoBlockingAccessibilityFindings(page);

  await expect
    .poll(async () => (await fixtureStatus(request)).contractFunctions.allOf ?? 0)
    .toBeGreaterThan(0);
  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("secondary project surfaces stay hydrated, contained, and accessible", async ({
  page,
  request,
}) => {
  const boundary = await installBrowserBoundary(page);

  const ownersResponse = await page.goto("/base:1/owners", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(ownersResponse);
  await expect(page.getByRole("heading", { level: 1, name: "Fixture Revnet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Token", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All", exact: true })).toBeVisible();
  await retryUntilVisible(
    () => page.getByRole("button", { name: "Auto issuance", exact: true }).click(),
    page.getByText("No auto issuances"),
  );
  await retryUntilVisible(
    () => page.getByRole("button", { name: "Loans", exact: true }).click(),
    page.getByRole("heading", { name: "Active loans", exact: true }),
  );
  await expect(page.getByRole("columnheader", { name: "Prepaid fee" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Current fee outstanding" })).toBeVisible();
  await expect(page.getByText("603.5741 USDC")).toBeVisible();
  await expect(page.getByText("2.5%")).toBeVisible();
  await expect(page.getByRole("cell", { name: "0 USDC", exact: true })).toBeVisible();
  await expectContained(page, ["nav", "main"]);
  await expectNoBlockingAccessibilityFindings(page);

  const shopResponse = await page.goto("/base:1/shop", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(shopResponse);
  await expect(page.getByText("This project has no shop.")).toBeVisible();
  await expectContained(page, ["nav", "main"]);

  const extrasResponse = await page.goto("/base:1/extras", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(extrasResponse);
  await expect(page.getByRole("heading", { name: "Payer address", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create payer address" })).toBeVisible();
  await expect(page.getByText("No deployed payer addresses indexed yet.")).toBeVisible();
  await expectContained(page, ["nav", "main"]);

  const operatorResponse = await page.goto("/base:1/operator", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(operatorResponse);
  for (const heading of ["Account", "Edits", "Buyback & swap router", "Permissions"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  // Scoped to main: while a streamed segment lands, the same markup exists twice —
  // once in React's hidden staging container and once in place.
  await expect(page.locator("main").getByText("Set project uri")).toBeVisible();
  await expect(page.locator("main").getByText("Set project handle")).toBeVisible();
  await retryUntilVisible(
    () => page.getByRole("button", { name: "Set project handle", exact: true }).click(),
    page.getByRole("dialog"),
  );
  const projectHandleDialog = page.getByRole("dialog");
  await expect(
    projectHandleDialog.getByRole("heading", { name: "Set project handle" }),
  ).toBeVisible();
  await expect(
    projectHandleDialog.getByText("You’ll be able to find your project at", { exact: false }),
  ).toBeVisible();
  await expect(projectHandleDialog.getByLabel("Your .eth name")).toHaveAttribute(
    "placeholder",
    "banny.eth",
  );
  const projectOrigin = new URL(page.url()).origin;
  const projectUrl = `${projectOrigin}/@fixture-revnet`;
  const projectUrlPreview = projectHandleDialog.getByText(
    "You’ll be able to find your project at",
    {
      exact: false,
    },
  );
  // The future URL is announced, never linked: the handle is not live until
  // the second transaction lands.
  await expect(projectHandleDialog.getByRole("link", { name: projectUrl })).toHaveCount(0);
  await expect(projectUrlPreview).toHaveText(
    `You’ll be able to find your project at ${projectUrl}`,
  );
  await projectHandleDialog.getByLabel("Your .eth name").fill("FIXTURE-REVNET.ETH");
  await expect(projectUrlPreview).toHaveText(
    `You’ll be able to find your project at ${projectUrl}`,
  );
  await projectHandleDialog.getByLabel("Your .eth name").fill("");
  await expect(projectUrlPreview).toHaveText(
    `You’ll be able to find your project at ${projectOrigin}/@<handle>`,
  );
  await projectHandleDialog.getByRole("button", { name: "Close" }).click();
  await expect(projectHandleDialog).toBeHidden();
  const secondaryActions = [
    "Transfer revnet operator",
    "Edit metadata",
    "Extend to another chain",
    "Set buyback hook",
    "Set router terminal",
    "Initialize buyback pool",
  ];
  for (const name of secondaryActions) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveClass(/border-melon-300/u);
    await expect(button).toHaveClass(/bg-melon-25/u);
  }

  const handleResponse = await page.goto("/@fixture-revnet/operator", {
    waitUntil: "domcontentloaded",
  });
  expectSecurityHeaders(handleResponse);
  await expect(page).toHaveURL(/\/@fixture-revnet\/operator$/u);
  await expect(page.locator("main").getByText("Set project handle")).toBeVisible();
  await retryUntilVisible(
    () => page.getByRole("button", { name: "Set project handle", exact: true }).click(),
    page.getByRole("dialog"),
  );
  await expect(page.getByRole("dialog")).toContainText(
    `You’ll be able to find your project at ${projectUrl}`,
  );
  await expectContained(page, ["nav", "main"]);
  await expectNoBlockingAccessibilityFindings(page);

  const handleOwnersResponse = await page.goto("/@fixture-revnet/owners", {
    waitUntil: "domcontentloaded",
  });
  expectSecurityHeaders(handleOwnersResponse);
  const refreshedSubtab = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "document" &&
      new URL(response.url()).pathname === "/@fixture-revnet/owners" &&
      new URL(response.url()).searchParams.get("subtab") === "splits",
  );
  await retryUntilVisible(
    () => page.getByRole("button", { name: "Splits", exact: true }).click(),
    page.getByText("No splits on this chain."),
  );
  expectSecurityHeaders(await refreshedSubtab);
  await expect(page).toHaveURL(/\/@fixture-revnet\/owners\?subtab=splits$/u);
  await expect(page.getByText("No splits on this chain.")).toBeVisible();

  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  expect(status.graphqlOperations.V6ProjectPayers).toBeGreaterThan(0);
  expect(status.graphqlOperations.V6PermissionHolders).toBeGreaterThan(0);
  expect(status.rpcMethods.eth_getLogs).toBeGreaterThan(0);
  expect(status.graphqlOperations.V6StoredAutoIssuances).toBeGreaterThan(0);
  expect(status.graphqlOperations.V6AutoIssueEvents).toBeGreaterThan(0);
  expect(status.graphqlOperations.V6AllLoans).toBeGreaterThan(0);
  expect(status.contractFunctions.ownerOf).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("verified handle routes decode exactly once", async ({ page, request }) => {
  const boundary = await installBrowserBoundary(page);
  const narrowViewport = page.viewportSize()?.width === 320;
  if (narrowViewport) {
    // A real long wallet identity guarantees the collapsed search layout on
    // every platform, independent of the font metrics of the Sign in button.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "revnet:view-as:v1",
        "0x2222222222222222222222222222222222222222",
      );
    });
  }
  // Hold hydration deterministically: the SSR form must not accept text which
  // React cannot retain yet or natively submit to the current project URL.
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  const scriptPattern = /\/_next\/static\/.*\.js(?:\?.*)?$/u;
  await page.route(scriptPattern, async (route) => {
    await scriptsReady;
    await route.fallback();
  });
  // Hydration is a DOM state, including when the responsive navigation hides
  // its inline field behind the mobile Search button.
  const serverSearch = page.getByRole("searchbox", {
    name: /Search revnets/u,
    includeHidden: true,
  });
  try {
    const projectResponse = await page.goto("/base:1/operator", { waitUntil: "commit" });
    expectSecurityHeaders(projectResponse);
    await expect(serverSearch).toBeDisabled();
  } finally {
    releaseScripts();
  }
  await page.waitForLoadState("domcontentloaded");
  await expect(serverSearch).toBeEnabled();
  await page.unroute(scriptPattern);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const mobileSearch = page.getByRole("button", { name: "Search", exact: true });
  if (narrowViewport) {
    await expect(
      page.getByRole("button", { name: /Viewing as artizenendowment\.eth/i }),
    ).toBeVisible();
    await expect(mobileSearch).toBeVisible();
  }
  if (await mobileSearch.isVisible()) await mobileSearch.click();
  const search = page.getByRole("searchbox", { name: /Search revnets/u });
  await expect(search).toBeVisible();
  await expect(search).toBeEnabled();
  await search.fill("@fixture-revnet");
  const searchNavigation = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "document" &&
      new URL(response.url()).pathname === "/@fixture-revnet",
  );
  await search.press("Enter");
  expectSecurityHeaders(await searchNavigation);
  await expect(page).toHaveURL(/\/@fixture-revnet$/u);

  const handleResponse = await page.goto("/@fixture-revnet/operator", {
    waitUntil: "domcontentloaded",
  });
  expectSecurityHeaders(handleResponse);
  expect(handleResponse?.status()).toBe(200);
  await expect(page.locator("main").getByText("Set project handle")).toBeVisible();

  // On a mutable alias, mobile Latest/Overview changes must survive the
  // document navigation which revalidates the alias.
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileHandleResponse = await page.goto("/@fixture-revnet", {
    waitUntil: "domcontentloaded",
  });
  expectSecurityHeaders(mobileHandleResponse);
  await expect(page.locator("[data-mobile-project-activity]")).toBeVisible();
  await expect(page.locator("[data-mobile-project-content]")).toBeHidden();
  const overviewNavigation = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "document" &&
      new URL(response.url()).pathname === "/@fixture-revnet" &&
      new URL(response.url()).searchParams.get("view") === "overview",
  );
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  expectSecurityHeaders(await overviewNavigation);
  await expect(page).toHaveURL(/\/@fixture-revnet\?view=overview$/u);
  await expect(page.locator("[data-mobile-project-content]")).toBeVisible();
  await expect(page.locator("[data-mobile-project-activity]")).toBeHidden();
  const latestNavigation = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "document" &&
      new URL(response.url()).pathname === "/@fixture-revnet" &&
      !new URL(response.url()).search,
  );
  await page.getByRole("link", { name: "Latest", exact: true }).click();
  expectSecurityHeaders(await latestNavigation);
  await expect(page.locator("[data-mobile-project-activity]")).toBeVisible();

  // Returning to a cached alias through browser history also gets a fresh
  // document request instead of reviving an old ProjectProviders layout.
  const aliasBeforeHistory = await page.goto("/@fixture-revnet/operator", {
    waitUntil: "domcontentloaded",
  });
  expectSecurityHeaders(aliasBeforeHistory);
  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await expect(page).toHaveURL(/\/learn$/u);
  const backNavigation = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "document" &&
      new URL(response.url()).pathname === "/@fixture-revnet/operator",
  );
  // The alias guard intentionally starts a second document reload from the
  // popstate handler. Waiting for the first navigation's load event races that
  // replacement; commit proves history moved, while backNavigation below
  // proves the fresh alias document was actually requested.
  await page.goBack({ waitUntil: "commit" });
  expectSecurityHeaders(await backNavigation);
  await expect(page.locator("main").getByText("Set project handle")).toBeVisible();

  const doubleEncodedResponse = await page.goto("/%2540fixture-revnet/operator", {
    waitUntil: "domcontentloaded",
  });
  expectSecurityHeaders(doubleEncodedResponse, 404);
  expect(doubleEncodedResponse?.status()).toBe(404);
  await expect(page.locator("main").getByText("Set project handle")).toHaveCount(0);

  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  expectBoundaryToStayLocal(boundary);
});

test("home and discover shells stay contained and deterministic", async ({ page }) => {
  const boundary = await installBrowserBoundary(page);
  await page.route("**/api/telligence/v1/projects", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ projects: [] }) }),
  );
  const homeResponse = await page.goto("/", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(homeResponse);
  await expect(
    page.getByRole("heading", { name: "Throw money at a problem together" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Submit", exact: true })).toBeVisible();
  await expect(page.locator("#roots-heading")).toHaveCount(0);
  await expect(page.locator("#projects")).toHaveCount(0);
  await expect(
    page.getByText("Tell people what you're working towards and why it needs compute.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("04 / Share the rewards", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Return rewards to the revnet for supporters to share.", { exact: true }),
  ).toBeVisible();
  await expectContained(page, ["main", "footer"]);
  await expectNoBlockingAccessibilityFindings(page);

  const discoverResponse = await page.goto("/discover", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(discoverResponse);
  await expect(page.getByRole("heading", { name: "Find a purpose", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Find a purpose you believe in." })).toBeVisible();
  await expect(page.getByText("Be the first to put an idea to work.")).toBeVisible();
  await expectContained(page, ["main", "footer", "h2"]);
  await expectNoBlockingAccessibilityFindings(page);
  expectBoundaryToStayLocal(boundary);
});
