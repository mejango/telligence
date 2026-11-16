import { expect, test } from "@playwright/test";
import { expectNoBlockingAccessibilityFindings, installBrowserBoundary } from "./browser-support";

test("homepage Rent keeps Preview local and requires verified setup before Take over", async ({
  page,
}) => {
  await installBrowserBoundary(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const card = page.getByRole("region", { name: "Markee advertisement" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Your message could be here.");
  expect(
    await card.evaluate((element) =>
      Boolean(
        element.compareDocumentPosition(document.getElementById("home-top")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  ).toBe(true);
  expect(await card.locator("p").evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    "16px",
  );
  const trigger = card.getByRole("button", { name: "Take over this advertisement" });
  await trigger.focus();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Rent this space" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Connect admin wallet" })).toBeVisible();
  await dialog.getByLabel("Your message").fill("Build in the open.");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(dialog.locator("p").filter({ hasText: /^Build in the open\.$/ })).toBeVisible();
  await expect(card).toContainText("Your message could be here.");
  await expect(dialog.getByRole("button", { name: "Take over", exact: true })).toBeDisabled();
  await expect(dialog.getByText(/This demo|Example rate|Preview on homepage/)).toHaveCount(0);
  await expectNoBlockingAccessibilityFindings(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
