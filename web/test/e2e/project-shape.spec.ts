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
  await expect(page.getByRole("columnheader", { name: "Current repayment fee" })).toBeVisible();
  await expect(page.getByText("603.57 USDC")).toBeVisible();
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
  for (const heading of ["Account", "Edits", "Buyback hook", "Swap router", "Permissions"]) {
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
  const subtabDocuments: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") subtabDocuments.push(request.url());
  });
  await retryUntilVisible(
    () => page.getByRole("button", { name: "Splits", exact: true }).click(),
    page.getByText("No splits on this chain."),
  );
  expect(subtabDocuments).toEqual([]);
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
  // The router terminal is read from the project's own terminal list (the SDK's resolver).
  expect(status.contractFunctions.terminalsOf).toBeGreaterThan(0);
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

  // Verified alias view changes retain the project and never reload the document.
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileHandleResponse = await page.goto("/@fixture-revnet", {
    waitUntil: "domcontentloaded",
  });
  expectSecurityHeaders(mobileHandleResponse);
  await expect(page.locator("[data-mobile-project-activity]")).toBeVisible();
  await expect(page.locator("[data-mobile-project-content]")).toBeHidden();
  const viewDocuments: string[] = [];
  const trackDocument = (request: import("@playwright/test").Request) => {
    if (request.resourceType() === "document") viewDocuments.push(request.url());
  };
  page.on("request", trackDocument);
  await page.getByRole("link", { name: "Overview", exact: true }).click();

  await expect(page).toHaveURL(/\/@fixture-revnet\?view=overview$/u);
  await expect(page.locator("[data-mobile-project-content]")).toBeVisible();
  await expect(page.locator("[data-mobile-project-activity]")).toBeHidden();
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(page.locator("[data-mobile-project-activity]")).toBeVisible();

  expect(viewDocuments).toEqual([]);
  page.off("request", trackDocument);

  // Returning to a cached alias verifies the binding without reloading its document.
  const aliasBeforeHistory = await page.goto("/@fixture-revnet/operator", {
    waitUntil: "domcontentloaded",
  });
  expectSecurityHeaders(aliasBeforeHistory);
  await page.getByRole("link", { name: "Learn", exact: true }).click();
  await expect(page).toHaveURL(/\/learn$/u);
  viewDocuments.length = 0;
  page.on("request", trackDocument);
  await page.goBack();
  await expect(page.locator("main").getByText("Set project handle")).toBeVisible();

  expect(viewDocuments).toEqual([]);
  page.off("request", trackDocument);

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

test("deployment diagnostics are available from Extras without a wallet", async ({
  page,
  context,
  request,
}) => {
  const boundary = await openFixtureProject(page);
  await expect(page.getByRole("dialog", { name: "Check deployment" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check deployment" })).toHaveCount(0);
  await page.getByRole("button", { name: "More project sections" }).click();
  await expect(page.getByRole("button", { name: "Check deployment" })).toHaveCount(0);
  await page.getByRole("link", { name: "Extras" }).click();
  await expect(page.getByRole("heading", { name: "Deployment", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check deployment" }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/deployment-extras-${page.viewportSize()?.width}.png`,
  });
  await page.getByRole("button", { name: "Check deployment" }).click();
  const dialog = page.getByRole("dialog", { name: "Check deployment" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Onchain deployment" })).toBeVisible();
  await expect(dialog.getByText("Project exists", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Project data service" })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Check an operator's shop permissions" }).check();
  await expect(dialog.getByRole("textbox", { name: "Operator address" })).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await dialog.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(dialog.getByText("Diagnostics copied.")).toBeVisible();
  const report = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(report).toMatchObject({
    chainId: 1,
    projectId: "1",
    indexer: { project: "available", group: "available" },
  });
  expect(report.deployment.checkedBlock).toBeTruthy();
  expect(
    report.deployment.checks.some(
      (check: { id: string; status: string }) =>
        check.id === "project.owner" && check.status === "passed",
    ),
  ).toBe(true);
  await expectNoBlockingAccessibilityFindings(page);
  await expectContained(page, ["dialog [data-state='open']"]);
  await dialog.locator("[data-state='open']").evaluate((panel) => {
    panel.scrollTop = 0;
  });
  await page.screenshot({
    path: `test-results/deployment-diagnostics-${page.viewportSize()?.width}.png`,
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await fixtureStatus(request)).unknownRequests).toEqual([]);
  expectBoundaryToStayLocal(boundary);
});

/** An enabled input may still be inert while its alias authority is being verified. */
async function fillReadyPaymentDraft(page: Page, amount: string) {
  const boundary = page.locator("[data-project-route-boundary]");
  await expect(boundary).toHaveAttribute("aria-busy", "false");
  const input = page.getByLabel("Amount");
  await expect(input).toBeEnabled();
  await expect
    .poll(() => input.evaluate((element) => element.closest("[inert]") === null))
    .toBe(true);
  await input.fill(amount);
  await expect(input).toHaveValue(amount);
}

test("alias tabs and chart ranges retain document, payment draft and URL filters", async ({
  page,
  request,
}) => {
  const boundary = await installBrowserBoundary(page);
  await page.goto("/@fixture-revnet?view=overview&filter=held#chart");
  await expect(page.getByRole("heading", { level: 1, name: "Fixture Revnet" })).toBeVisible();
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  await fillReadyPaymentDraft(page, "12");
  const range = page.getByLabel("Time range");
  await expect(range).toBeVisible();
  await range.selectOption("7d");
  await expect(page).toHaveURL(/filter=held.*range=7d#chart$/u);
  await expect(range).toHaveValue("7d");
  await expect(page.getByLabel("Amount")).toHaveValue("12");
  // This fixture has issuance history but no pool. Exercise its real range
  // control and native history instead of a pool-only view selector.
  await range.selectOption("1d");
  await expect(page).toHaveURL(/filter=held.*range=1d#chart$/u);
  await expect(range).toHaveValue("1d");
  await expect(page.getByLabel("Amount")).toHaveValue("12");
  await page.goBack();
  await expect(page).toHaveURL(/filter=held.*range=7d#chart$/u);
  await expect(range).toHaveValue("7d");
  await expect(page.getByLabel("Amount")).toHaveValue("12");
  await page.goForward();
  await expect(page).toHaveURL(/filter=held.*range=1d#chart$/u);
  await expect(range).toHaveValue("1d");
  await expect(page.getByLabel("Amount")).toHaveValue("12");
  await page.getByRole("link", { name: "Terms", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stages", exact: true })).toBeVisible();
  await expect(page.getByLabel("Amount")).toHaveValue("12");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
  await expect(page.getByLabel("Amount")).toHaveValue("12");
  expect(documents).toEqual([]);
  expect((await fixtureStatus(request)).unknownRequests).toEqual([]);
  expectBoundaryToStayLocal(boundary);
});

async function holdProjectPage(page: Page, pathname: string) {
  let requested = false;
  let completed = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const matches = (url: URL) =>
    decodeURIComponent(url.pathname) === pathname && url.searchParams.has("_rsc");
  await page.route(matches, async (route) => {
    requested = true;
    // Fetch the real page while withholding its delivery to the router. This
    // exercises actual React transitions and allows a discarded page to arrive late.
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
    completed = true;
  });
  return {
    release,
    waitUntilRequested: () => expect.poll(() => requested).toBe(true),
    deliver: async () => {
      release();
      await expect.poll(() => completed).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
  };
}

test("alias tab pending feedback follows the latest intent and committed content", async ({
  page,
  request,
}) => {
  const boundary = await installBrowserBoundary(page);
  await page.goto("/@fixture-revnet?view=overview");
  await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
  await fillReadyPaymentDraft(page, "12");
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });

  const termsResponse = await holdProjectPage(page, "/@fixture-revnet/terms");
  const ownersResponse = await holdProjectPage(page, "/@fixture-revnet/owners");
  const overview = page.getByRole("link", { name: "Overview", exact: true });
  const terms = page.getByRole("link", { name: "Terms", exact: true });
  const owners = page.getByRole("link", { name: "Owners", exact: true });
  const menu = page.locator("[data-project-tab-scroll]");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const termsWidth = await terms.evaluate((element) => element.getBoundingClientRect().width);
  try {
    await terms.click();
    await termsResponse.waitUntilRequested();
    await expect(terms.locator('[aria-busy="true"]')).toBeVisible();
    await expect(menu.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(terms).toHaveAccessibleName("Terms");
    await expect(terms.getByRole("status").locator('[aria-hidden="true"]')).toBeVisible();
    expect(await terms.evaluate((element) => element.getBoundingClientRect().width)).toBe(
      termsWidth,
    );
    await expect(overview).toHaveClass(/border-teal-500/u);
    await expect(terms).not.toHaveClass(/border-teal-500/u);
    await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading terms", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Amount")).toHaveValue("12");

    await owners.click();
    await ownersResponse.waitUntilRequested();
    await expect(owners.locator('[aria-busy="true"]')).toBeVisible();
    await expect(terms.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(menu.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(owners).toHaveAccessibleName("Owners");
    await expect(overview).toHaveClass(/border-teal-500/u);
    await expect(owners).not.toHaveClass(/border-teal-500/u);
    await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();

    await ownersResponse.deliver();
    await expect(page).toHaveURL(/\/@fixture-revnet\/owners$/u);
    await expect(page.getByRole("button", { name: "Accounts", exact: true })).toBeVisible();
    await expect(owners).toHaveClass(/border-teal-500/u);
    await expect(overview).not.toHaveClass(/border-teal-500/u);
    await expect(menu.locator('[aria-busy="true"]')).toHaveCount(0);

    // The older response must neither select Terms nor restart its indicator.
    await termsResponse.deliver();
    await expect(page).toHaveURL(/\/@fixture-revnet\/owners$/u);
    await expect(page.getByRole("button", { name: "Accounts", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stages", exact: true })).toHaveCount(0);
    await expect(owners).toHaveClass(/border-teal-500/u);
    await expect(menu.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByLabel("Amount")).toHaveValue("12");
    expect(documents).toEqual([]);
    expect((await fixtureStatus(request)).unknownRequests).toEqual([]);
    expectBoundaryToStayLocal(boundary);
  } finally {
    termsResponse.release();
    ownersResponse.release();
  }
});

test("Latest supersedes a pending alias tab without reviving its feedback", async ({
  page,
  request,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) > 800, "Latest is a single-column control");
  const boundary = await installBrowserBoundary(page);
  await page.goto("/@fixture-revnet?view=overview");
  await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
  await fillReadyPaymentDraft(page, "12");
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  const termsResponse = await holdProjectPage(page, "/@fixture-revnet/terms");
  const terms = page.getByRole("link", { name: "Terms", exact: true });
  const latest = page.getByRole("button", { name: "Latest", exact: true });
  const menu = page.locator("[data-project-tab-scroll]");
  try {
    await terms.click();
    await termsResponse.waitUntilRequested();
    await expect(terms.locator('[aria-busy="true"]')).toBeVisible();
    await latest.click();
    await expect(page).toHaveURL(/\/@fixture-revnet\?view=latest$/u);
    await expect(page.locator("[data-mobile-project-activity]")).toBeVisible();
    await expect(page.locator("[data-mobile-project-content]")).toBeHidden();
    await expect(latest).toHaveClass(/border-teal-500/u);
    await expect(menu.locator('[aria-busy="true"]')).toHaveCount(0);

    await termsResponse.deliver();
    await expect(page).toHaveURL(/\/@fixture-revnet\?view=latest$/u);
    await expect(page.locator("[data-mobile-project-activity]")).toBeVisible();
    await expect(latest).toHaveClass(/border-teal-500/u);
    await expect(menu.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByLabel("Amount")).toHaveValue("12");
    expect(documents).toEqual([]);
    expect((await fixtureStatus(request)).unknownRequests).toEqual([]);
    expectBoundaryToStayLocal(boundary);
  } finally {
    termsResponse.release();
  }
});
