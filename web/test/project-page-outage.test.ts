// Bendystraw returning nothing is indistinguishable from a project that doesn't exist, so a page
// that resolves with the raw indexed read 404s live projects during an indexer outage — telling the
// owner their revnet was deleted. `getProjectWithFallback` settles the question on-chain first and
// only returns null when the project genuinely isn't there; the layout has always used it, and every
// tab page under it must too. This scans the sources because the regression is a NEW page copying
// the old pattern, which no runtime test of the existing pages would catch.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SLUG_DIR = join(process.cwd(), "src/app/[slug]");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === "page.tsx" || entry.name === "layout.tsx" ? [path] : [];
  });
}

describe("project route outage handling", () => {
  const files = pageFiles(SLUG_DIR);

  it("finds the project routes to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files)("%s resolves through the on-chain fallback", (file) => {
    const source = readFileSync(file, "utf8");
    if (!source.includes("notFound()")) return; // nothing to 404 with

    expect(source).toContain("getProjectWithFallback");
    // The precise anti-pattern: 404-ing on the bare indexed read. Using `getProject` for
    // best-effort work that degrades on its own (page metadata) stays fine.
    expect(source).not.toMatch(
      /const\s+(\w+)\s*=\s*await\s+getProject\([^)]*\);\s*if\s*\(!\1\)\s*notFound\(\)/,
    );
  });
});
