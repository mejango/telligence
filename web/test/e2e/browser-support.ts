import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type Response } from "@playwright/test";
import browserProject from "../fixtures/browser-project.json";

export const FIXTURE_ORIGIN = `http://127.0.0.1:${browserProject.fixturePort}`;
const FIXTURE_CID = browserProject.cid;

export type BrowserBoundary = {
  externalRequests: string[];
  pageErrors: string[];
};

export async function installBrowserBoundary(page: Page): Promise<BrowserBoundary> {
  const boundary: BrowserBoundary = { externalRequests: [], pageErrors: [] };
  page.on("pageerror", (error) => boundary.pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/ipfs/${FIXTURE_CID}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        body: JSON.stringify(browserProject.metadata),
      });
      return;
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      await route.continue();
      return;
    }
    boundary.externalRequests.push(url.href);
    await route.abort("blockedbyclient");
  });
  await page.routeWebSocket(/^wss?:\/\//, async (socket) => {
    const url = new URL(socket.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      boundary.externalRequests.push(socket.url());
    }
    await socket.close({ code: 1008, reason: "Browser WebSocket traffic is disabled in tests" });
  });
  return boundary;
}

export function expectBoundaryToStayLocal(boundary: BrowserBoundary): void {
  expect(boundary.externalRequests, "production page attempted external traffic").toEqual([]);
  expect(boundary.pageErrors, "production page raised uncaught browser errors").toEqual([]);
}

/**
 * An interaction that lands before React hydrates is a no-op: the server sent the
 * markup, but no handler is attached yet. Retry the interaction until it takes.
 */
export async function retryUntilVisible(
  act: () => Promise<void>,
  expected: Locator,
): Promise<void> {
  await expect(async () => {
    await act();
    await expect(expected).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

export function expectSecurityHeaders(response: Response | null, expectedStatus = 200): void {
  expect(response?.status()).toBe(expectedStatus);
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain(
    "frame-ancestors https://app.safe.global https://app.5afe.dev",
  );
  expect(headers["x-frame-options"]).toBeUndefined();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-permitted-cross-domain-policies"]).toBe("none");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["permissions-policy"]).toContain("microphone=()");
  expect(headers["permissions-policy"]).toContain("geolocation=()");
}

export async function expectContained(page: Page, selectors: string[]): Promise<void> {
  const geometry = await page.evaluate((requiredSelectors) => {
    const viewport = document.documentElement.clientWidth;
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      elements: requiredSelectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, missing: true, left: 0, right: 0, width: 0 };
        const rect = element.getBoundingClientRect();
        return {
          selector,
          missing: false,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      }),
    };
  }, selectors);

  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  for (const element of geometry.elements) {
    expect(element.missing, `${element.selector} must exist`).toBe(false);
    expect(element.left, `${element.selector} left edge`).toBeGreaterThanOrEqual(-1);
    expect(element.right, `${element.selector} right edge`).toBeLessThanOrEqual(
      geometry.viewport + 1,
    );
    expect(element.width, `${element.selector} width`).toBeGreaterThan(0);
  }
}

export async function expectNoBlockingAccessibilityFindings(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    ({ id, impact }) => id === "color-contrast" || impact === "critical" || impact === "serious",
  );
  expect(
    blocking,
    blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
  ).toEqual([]);
}
