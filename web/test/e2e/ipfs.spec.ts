import { expect, test } from "@playwright/test";

const CID = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR";
const CENTER_PIN_URL = "https://juicebox.center/v1/pins/json";

test("pins metadata through Center with Chromium's native fetch", async ({ page }) => {
  const pageErrors: string[] = [];
  const pinBodies: unknown[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
  // Playwright gives the most recently registered matching route precedence.
  await page.route(CENTER_PIN_URL, async (route) => {
    expect(route.request().method()).toBe("POST");
    pinBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        cid: CID,
        status: "queued",
        uri: `ipfs://${CID}`,
        gatewayUrl: `/ipfs/${CID}`,
      }),
    });
  });

  await page.goto("/ipfs-proof");
  await expect(page.locator("[data-ipfs-proof-ready]")).toHaveAttribute(
    "data-ipfs-proof-ready",
    "true",
  );
  await page.getByRole("button", { name: "Save metadata" }).click();

  await expect(page.getByTestId("pin-result")).toHaveText(`ipfs://${CID}`);
  expect(pinBodies).toEqual([{ name: "Revnet browser proof" }]);
  expect(pageErrors).toEqual([]);
});
