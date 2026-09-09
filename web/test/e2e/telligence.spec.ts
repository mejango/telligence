import { expect, test, type Page } from "@playwright/test";
import {
  expectBoundaryToStayLocal,
  expectContained,
  expectNoBlockingAccessibilityFindings,
  expectSecurityHeaders,
  installBrowserBoundary,
} from "./browser-support";

const project = {
  id: "base-12",
  chainId: 8453,
  revnetId: "12",
  name: "The open archive",
  purpose:
    "Make a century of public records useful to the people they belong to. We are building a free research assistant that can read, connect, and cite the archive, so a good question can find its way to an answer.",
  workload: "Document understanding · archival research",
  targetDailyCreditUsd: "25",
  status: "active",
  policyVersion: "1",
  createdAt: "2026-09-09T12:00:00Z",
  wrapperAddress: "0x1111111111111111111111111111111111111111",
  vaultAddress: "0x2222222222222222222222222222222222222222",
  creatorAddress: "0x3333333333333333333333333333333333333333",
  capacity: {
    status: "ready",
    dailyCreditUsd: "18.40",
    remainingCreditUsd: "7.25",
    observedAt: new Date().toISOString(),
  },
};
const starting = {
  ...project,
  id: "base-13",
  revnetId: "13",
  name: "A patient garden",
  purpose:
    "An open assistant for community gardens, helping growers share what they know about the land around them.",
  workload: "Community tools · local knowledge",
  status: "accumulating",
  capacity: {
    status: "provisioning",
    dailyCreditUsd: "0",
    remainingCreditUsd: "0",
    observedAt: null,
  },
};

async function setup(page: Page) {
  const boundary = await installBrowserBoundary(page);
  await page.route("**/api/telligence/v1/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ projects: [project, starting] }),
    }),
  );
  await page.route("**/api/telligence/v1/projects/base-12", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ project }) }),
  );
  await page.route("**/api/telligence/v1/config", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "not_configured", message: "The deployment is not configured." },
      }),
    }),
  );
  return boundary;
}

test("home invites a problem and discover renders actual projects with a responsive directory", async ({
  page,
}, testInfo) => {
  const boundary = await setup(page);
  const response = await page.goto("/");
  expectSecurityHeaders(response);
  await expect(
    page.getByRole("heading", { level: 1, name: "Throw money at a problem together" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Submit", exact: true })).toHaveAttribute(
    "href",
    "/create",
  );
  await expect(page.locator("#projects")).toHaveCount(0);
  await expect(page.locator('a[href="#projects"], a[href="/#projects"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expectContained(page, ["nav", "main", "footer", "h1"]);
  await expectNoBlockingAccessibilityFindings(page);
  await page.screenshot({
    path: `../docs/implementation/screenshots/home-${testInfo.project.name}.png`,
    fullPage: true,
  });

  const discoverResponse = await page.goto("/discover");
  expectSecurityHeaders(discoverResponse);
  await expect(page.getByRole("link", { name: /The open archive/ })).toBeVisible();
  await expect(page.getByText("$18.40", { exact: true })).toBeVisible();
  await expect(page.getByText("Awaiting verification", { exact: true })).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
  await expectContained(page, ["nav", "main", "footer", "#projects"]);
  await expectNoBlockingAccessibilityFindings(page);
  await page.getByRole("searchbox", { name: "Find a purpose" }).fill("archive");
  await expect(page.getByRole("link", { name: /A patient garden/ })).toHaveCount(0);
  expectBoundaryToStayLocal(boundary);
});

test("outage is actionable and never rendered as an empty fundraiser", async ({ page }) => {
  const boundary = await setup(page);
  await page.route("**/api/telligence/v1/projects", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "The project index is unavailable." } }),
    }),
  );
  await page.goto("/discover");
  await expect(page.locator("#projects").getByRole("alert")).toContainText(
    "The project index is unavailable.",
  );
  await expect(page.getByText("Be the first to put an idea to work.")).toHaveCount(0);
  await page.route("**/api/telligence/v1/projects", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ projects: [] }) }),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Be the first to put an idea to work.")).toBeVisible();
  expectBoundaryToStayLocal(boundary);
});

test("project distinguishes daily credit, remaining credit and ambition before funding", async ({
  page,
}, testInfo) => {
  const boundary = await setup(page);
  const response = await page.goto("/compute/base-12");
  expectSecurityHeaders(response);
  await expect(page.getByRole("heading", { name: "The open archive" })).toBeVisible();
  await expect(page.getByText("$18.40", { exact: true })).toBeVisible();
  await expect(page.getByText("$7.25", { exact: true })).toBeVisible();
  await expect(page.getByText("$25", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inspect the revnet" })).toHaveAttribute(
    "href",
    "/base:12",
  );
  await expect(page.getByText(/Backing committed to compute/)).toBeVisible();
  await page.getByText("Contracts & published policy", { exact: true }).click();
  await expect(page.getByText(project.vaultAddress, { exact: true })).toBeVisible();
  await expectContained(page, ["nav", "main", "footer", "h1", "aside"]);
  await expectNoBlockingAccessibilityFindings(page);
  await page.screenshot({
    path: `../docs/implementation/screenshots/project-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expectBoundaryToStayLocal(boundary);
});

test("key management requires creator authentication and contains its disconnected state", async ({
  page,
}, testInfo) => {
  const boundary = await setup(page);
  await page.goto("/compute/base-12/keys");
  await expect(page.getByRole("heading", { name: "Your project's API keys." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
  await expect(page.getByText(/tlg_/)).toHaveCount(0);
  await expectContained(page, ["nav", "main", "footer"]);
  await expectNoBlockingAccessibilityFindings(page);
  await page.screenshot({
    path: `../docs/implementation/screenshots/keys-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expectBoundaryToStayLocal(boundary);
});

test("mechanics explain supporter rights and provider limitations accessibly", async ({ page }) => {
  const boundary = await setup(page);
  await page.goto("/how-it-works");
  await expect(page.getByRole("heading", { name: /A purpose on the surface/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What your contribution does" })).toBeVisible();
  await expect(
    page.getByText(/rather than promising a refund to the original contributors/),
  ).toBeVisible();
  await expectContained(page, ["nav", "main", "footer", "h1"]);
  await expectNoBlockingAccessibilityFindings(page);
  expectBoundaryToStayLocal(boundary);
});
