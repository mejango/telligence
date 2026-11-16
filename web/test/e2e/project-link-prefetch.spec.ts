import { expect, test, type Page } from "@playwright/test";
import { expectBoundaryToStayLocal, installBrowserBoundary } from "./browser-support";

// Next re-requests a prefetch without end once more than four links to a dynamic route whose
// segment holds a `:` (every `chain:id` project URN) are in view, so project links must never
// prefetch.
const QUIET_MS = 2_000;
const SETTLE_DEADLINE_MS = 12_000;

const projects = [2, 3, 4, 5, 6, 7, 8, 9].map((projectId) => ({
  projectId,
  chainId: 1,
  chainIds: [1],
  suckerGroupId: `prefetch-sample-${projectId}`,
  name: `Prefetch Sample ${projectId}`,
  projectTagline: "A sample project for the prefetch check.",
  logoUri: null,
  handle: null,
}));

function watchRscRequests(page: Page) {
  const paths: string[] = [];
  let lastAt = 0;
  page.on("request", (request) => {
    if (request.headers()["rsc"] !== "1") return;
    paths.push(new URL(request.url()).pathname);
    lastAt = Date.now();
  });
  return { paths, sinceLast: () => Date.now() - lastAt };
}

function busiest(paths: string[]) {
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

test("discover settles with more than four project links in view", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "Prefetching does not depend on the viewport once five project links are in view",
  );
  const boundary = await installBrowserBoundary(page);
  await page.route("**/api/discover-projects", (route) => route.fulfill({ json: { projects } }));
  const rsc = watchRscRequests(page);

  await page.goto("/discover", { waitUntil: "load" });

  const projectLinks = page.getByRole("link", { name: /Prefetch Sample/ });
  await expect(projectLinks).toHaveCount(projects.length);
  const linksInView = await projectLinks.evaluateAll(
    (links) =>
      new Promise<number>((resolve) => {
        const observer = new IntersectionObserver((entries) => {
          observer.disconnect();
          resolve(entries.filter((entry) => entry.isIntersecting).length);
        });
        for (const link of links) observer.observe(link);
      }),
  );
  expect(linksInView, "the fold must hold more than four project links").toBeGreaterThan(4);

  // Links to static routes still prefetch, so the prefetcher is running by the time silence is
  // judged.
  await expect
    .poll(() => rsc.paths.length, { message: "the prefetcher never started" })
    .toBeGreaterThan(0);
  const deadline = Date.now() + SETTLE_DEADLINE_MS;
  while (rsc.sinceLast() < QUIET_MS && Date.now() < deadline) {
    await page.waitForTimeout(250);
  }

  expect(
    rsc.sinceLast(),
    `RSC requests never went quiet: ${rsc.paths.length} so far, busiest ${JSON.stringify(busiest(rsc.paths))}`,
  ).toBeGreaterThanOrEqual(QUIET_MS);
  expect(
    rsc.paths.filter((path) => path.includes(":")),
    "project routes must not be prefetched",
  ).toEqual([]);
  expectBoundaryToStayLocal(boundary);
});
