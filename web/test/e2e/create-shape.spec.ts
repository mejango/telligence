import { expect, test, type Page } from "@playwright/test";
import {
  expectBoundaryToStayLocal,
  expectContained,
  expectNoBlockingAccessibilityFindings,
  expectSecurityHeaders,
  installBrowserBoundary,
  type BrowserBoundary,
} from "./browser-support";

async function openCreatePage(page: Page): Promise<BrowserBoundary> {
  const boundary = await installBrowserBoundary(page);
  await page.route("**/api/telligence/v1/config", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ready: true,
        policyVersion: "2",
        chainId: 8453,
        factoryAddress: "0x1111111111111111111111111111111111111111",
        canonicalTerminal: "0x2222222222222222222222222222222222222222",
        vvvAddress: "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf",
        launchPolicy: {
          conversionCadence: "3600",
          minBatchTokens: "1000000000000000000",
          maxBatchTokens: "100000000000000000000000",
          minVVVPerProjectToken: "100000000000000",
          minDiemPerVVV: "10000000000000000",
          maxPrincipal: "10000000000000000000000",
          initialIssuance: "1000000000000000000000000",
        },
      }),
    }),
  );
  const response = await page.goto("/create", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response);
  await expect(
    page.getByRole("heading", { name: /What would you build with a budget to think/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review" })).toBeEnabled();
  return boundary;
}

test("standalone health endpoint exposes immutable build identity", async ({ request }) => {
  const response = await request.get("/api/healthz");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ revision: "browser-test", status: "ok" });
});

test("navigation preserves the viewed identity and purpose journey at every width", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("revnet:view-as:v1", "0x2222222222222222222222222222222222222222"),
  );
  const boundary = await openCreatePage(page);
  await expect(
    page.getByRole("button", { name: /Viewing as artizenendowment\.eth/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Telligence home" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Learn", exact: true }),
  ).toBeVisible();
  await expectContained(page, ["nav", "main", "footer", "h1", "#compute-name"]);
  expectBoundaryToStayLocal(boundary);
});

test("compute launch leads with purpose and keeps network policy fixed", async ({ page }) => {
  const boundary = await openCreatePage(page);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Why do you need compute?" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "What will it do?" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Daily compute goal (optional)" })).toHaveCount(0);
  await expect(page.locator("form > section > h2")).toHaveText([
    /01\s*Give it a purpose/,
    /02\s*A clear agreement/,
  ]);
  await expect(page.getByRole("textbox", { name: "Ticker", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Deployment environment" })).toHaveCount(0);
  await page.getByText("Inspect the starting terms", { exact: true }).click();
  await expect(page.getByText("Base", { exact: true })).toBeVisible();
  await expect(page.getByText("VVV", { exact: true })).toBeVisible();
  await expect(page.getByText("40%", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Cash-out tax", { exact: true }).locator("..").getByText("10%", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('a[href*="/undefined/"]')).toHaveCount(0);
  await expectContained(page, [
    "nav",
    "main",
    "footer",
    "h1",
    "#compute-name",
    "#compute-purpose",
    "#compute-operatorSplitBps",
  ]);
  expectBoundaryToStayLocal(boundary);
});

test("empty purpose and malformed operator share cannot reach wallet review", async ({ page }) => {
  const boundary = await openCreatePage(page);
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("Explain your purpose in 20 to 4,000 characters.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeFocused();
  await page.getByRole("textbox", { name: "Project name" }).fill("Public archive");
  await page
    .getByRole("textbox", { name: "Why do you need compute?" })
    .fill("Make historical research accessible to everyone.");
  await page
    .getByRole("textbox", { name: "What will it do?" })
    .fill("Summarize archival documents");
  const operatorShare = page.getByRole("textbox", { name: "Operator token share" });
  await operatorShare.fill("1e3");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(operatorShare).toHaveAttribute("aria-invalid", "true");
  await expect(operatorShare).toBeFocused();
  await expect(
    page.getByText(
      "The operator share must be 0% or more, with up to two decimals, and leave tokens for funders.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review your project" })).toHaveCount(0);
  expectBoundaryToStayLocal(boundary);
});

test("review binds the written purpose and resets acknowledgement when editing", async ({
  page,
}, testInfo) => {
  const boundary = await openCreatePage(page);
  await page.getByRole("textbox", { name: "Project name" }).fill("Public archive");
  await page
    .getByRole("textbox", { name: "Why do you need compute?" })
    .fill("Make historical research accessible to everyone.");
  await page
    .getByRole("textbox", { name: "What will it do?" })
    .fill("Summarize archival documents");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Review your project" })).toBeFocused();
  await expect(page.getByText("Public archive", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/This launches a Base revnet with a 40% compute production split/),
  ).toBeVisible();
  const acknowledgement = page.getByRole("checkbox", { name: /I understand/ });
  await expect(acknowledgement).not.toBeChecked();
  await acknowledgement.check();
  await page.getByRole("button", { name: "Edit project" }).click();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Public archive");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(acknowledgement).not.toBeChecked();
  await expectContained(page, ["nav", "main", "footer", "h1", "#review-heading"]);
  await expectNoBlockingAccessibilityFindings(page);
  await page.screenshot({
    path: `../docs/implementation/screenshots/create-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expectBoundaryToStayLocal(boundary);
});

test("create remains keyboard usable with visible focus and accessible controls", async ({
  page,
}) => {
  const boundary = await openCreatePage(page);
  const name = page.getByRole("textbox", { name: "Project name" });
  const purpose = page.getByRole("textbox", { name: "Why do you need compute?" });
  await name.focus();
  await page.keyboard.type("Keyboard project");
  await expect(name).toHaveValue("Keyboard project");
  await page.keyboard.press("Tab");
  await expect(purpose).toBeFocused();
  await page.keyboard.type("Make useful research available to every person who needs it.");
  await expect(purpose).toHaveValue(/Make useful research/);
  await expectNoBlockingAccessibilityFindings(page);
  expectBoundaryToStayLocal(boundary);
});
