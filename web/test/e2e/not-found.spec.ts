import { expect, test } from "@playwright/test";
import { expectBoundaryToStayLocal, installBrowserBoundary } from "./browser-support";

// The 404's home link is a plain anchor (next/link there put the home bundle on every route), so
// it goes home with a full document load.
test("the 404 page's Return Home link loads the home page", async ({ page }) => {
  const boundary = await installBrowserBoundary(page);
  const response = await page.goto("/no-such-page/x/y", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Not found", level: 1 })).toBeVisible();
  await expect(page.getByText("Nothing at /no-such-page/x/y.")).toBeVisible();
  expectBoundaryToStayLocal(boundary);
  await page.getByRole("link", { name: "Return Home" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/u);
  await expect(page.getByRole("region", { name: "Markee advertisement" })).toBeVisible();
});
