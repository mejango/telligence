import { expect, test } from "@playwright/test";
import { installBrowserBoundary } from "./browser-support";

// The create route is heavy, so home doesn't prefetch it when its link scrolls into view; hover
// prefetches it ahead of the click.
test("home prefetches /create on hover, not on view", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280", "Hover needs a pointer");
  await installBrowserBoundary(page);
  const createRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["rsc"] === "1" && new URL(request.url()).pathname === "/create") {
      createRequests.push(request.url());
    }
  });
  await page.goto("/", { waitUntil: "load" });
  const link = page.getByRole("link", { name: "Create yours" });
  await expect(link).toBeInViewport();
  await page.waitForTimeout(2_000);
  expect(createRequests, "in view alone must not prefetch /create").toEqual([]);

  await link.hover();
  await expect.poll(() => createRequests.length).toBeGreaterThan(0);
  await link.click();
  await expect(page).toHaveURL(/\/create$/u);
});
