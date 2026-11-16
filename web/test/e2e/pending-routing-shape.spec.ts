import { expect, test } from "@playwright/test";
import protocolRollout from "../../src/lib/protocol-rollout.json";
import {
  expectBoundaryToStayLocal,
  expectContained,
  expectSecurityHeaders,
  FIXTURE_ORIGIN,
  installBrowserBoundary,
} from "./browser-support";

test("pending routing shows ready, cooldown, and final attempts above activity", async ({
  page,
  request,
}, testInfo) => {
  const boundary = await installBrowserBoundary(page);
  const fixture = await request.get(`${FIXTURE_ORIGIN}/__fixture/pending-routing`);
  expect(fixture.status()).toBe(200);
  const pending = await fixture.json();
  let pendingReads = 0;
  let sourceNameReads = 0;
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/bendystraw/mainnet/query")) return;
    const body = request.postDataJSON();
    if (body?.variables?.projectId === 6) {
      expect(body.variables).toEqual({ chainId: 1, projectId: 6, version: 6 });
      sourceNameReads += 1;
    }
  });
  await page.route("**/api/bendystraw/mainnet/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== "router-pending-calls.v1") {
      await route.fallback();
      return;
    }
    const current = protocolRollout.chains["1"].contracts.JBRouterTerminalGateway.toLowerCase();
    expect(body.variables).toEqual({
      chainId: 1,
      projectId: 1,
      gateway: body.variables.gateway,
      limit: 100,
      offset: 0,
    });
    // Every gateway generation is read; only the current one holds these payments.
    if (body.variables.gateway !== current) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { routerPendingCalls: { items: [], totalCount: 0 } } }),
      });
      return;
    }
    pendingReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pending),
    });
  });
  expectSecurityHeaders(await page.goto("/eth:1", { waitUntil: "domcontentloaded" }));
  const disclosure = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "3 payments need processing." }) });
  const section = disclosure.locator("..");
  await expect(disclosure.locator("summary")).toBeVisible();
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(disclosure.getByText("0.01 ETH", { exact: true })).not.toBeVisible();
  await disclosure.locator("summary").click();
  await expect(disclosure).toHaveAttribute("open");
  await expect(disclosure.getByText("2 of 3 payments ready to retry.")).toBeVisible();
  await expect(section.getByText("0.01 ETH", { exact: true })).toBeVisible();
  await expect(section.getByText("12.5 USDC", { exact: true })).toBeVisible();
  await expect(section.getByText("0.03 ETH", { exact: true })).toBeVisible();
  await expect(section.getByText(/Available after/)).toHaveCount(1);
  await expect(section.getByText("Payments in cooldown must wait.")).toBeVisible();

  // Browser builds deliberately have no wallet connectors. These are the real
  // action controls with their wallet gate; the cooldown still disables its row.
  const actions = section.getByRole("button").filter({ hasText: "Connect Wallet" });
  await expect(actions).toHaveCount(4);
  const paymentAction = (amount: string) =>
    section
      .getByText(amount, { exact: true })
      .locator("..")
      .getByRole("button", { name: "Retry payment", exact: true });
  await expect(
    section.getByRole("button", { name: "Retry all payments", exact: true }),
  ).toBeEnabled();
  await expect(paymentAction("0.01 ETH")).toBeEnabled();
  await expect(paymentAction("12.5 USDC")).toBeDisabled();
  await expect(paymentAction("0.03 ETH")).toBeEnabled();
  const latest = page.getByRole("heading", { name: "Latest", exact: true });
  await expect(latest).toBeVisible();
  const [pendingBox, latestBox] = await Promise.all([section.boundingBox(), latest.boundingBox()]);
  expect(pendingBox).not.toBeNull();
  expect(latestBox).not.toBeNull();
  expect(pendingBox!.y + pendingBox!.height).toBeLessThanOrEqual(latestBox!.y);
  await expectContained(page, ["main"]);
  const sectionBox = await section.boundingBox();
  expect(sectionBox!.x).toBeGreaterThanOrEqual(0);
  expect(sectionBox!.x + sectionBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await expect.poll(() => sourceNameReads).toBeGreaterThan(0);
  const statusResponse = await request.get(`${FIXTURE_ORIGIN}/__fixture/status`);
  const status = await statusResponse.json();
  expect(pendingReads).toBeGreaterThan(0);
  for (const name of [
    "pendingCallCommitmentOf",
    "pendingCallFailureOf",
    "RETRY_DELAY",
    "maximumQualifiedCallGas",
  ]) {
    expect(
      status.contractFunctions[name],
      `${name} must use the real RPC read path`,
    ).toBeGreaterThan(0);
  }
  expect(status.rpcMethods.eth_getBlockByNumber).toBeGreaterThan(0);
  expect(status.unknownRequests).toEqual([]);
  expectBoundaryToStayLocal(boundary);

  const screenshot = testInfo.outputPath("pending-routing-above-activity.png");
  await section.locator("..").screenshot({ path: screenshot });
  await testInfo.attach("Pending routing above activity", {
    path: screenshot,
    contentType: "image/png",
  });
});
