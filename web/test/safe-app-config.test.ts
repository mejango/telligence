import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../next.config.js") as {
  headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
};
const publicDirectory = resolve(process.cwd(), "public");

describe("Safe App hosting", () => {
  it("lets only the Safe app and plugin.money frame the app", async () => {
    const routes = await config.headers();
    const appHeaders = routes.find(({ source }) => source === "/:path*")?.headers ?? [];
    const byName = Object.fromEntries(appHeaders.map(({ key, value }) => [key, value]));
    const policy = byName["Content-Security-Policy"];

    expect(policy).toBe(
      "frame-ancestors https://app.safe.global https://app.5afe.dev https://plugin.money https://www.plugin.money",
    );
    // The exact match above is the real assertion; these say what it is protecting, so a
    // future edit that widens the allowlist fails for a legible reason.
    expect(policy).not.toMatch(/\*|'unsafe|http:\/\//u);
    expect(byName["X-Frame-Options"]).toBeUndefined();
  });

  it("serves a cross-origin-readable root manifest with a real icon", async () => {
    const routes = await config.headers();
    const manifestHeaders = routes.find(({ source }) => source === "/manifest.json")?.headers ?? [];
    expect(manifestHeaders).toContainEqual({
      key: "Access-Control-Allow-Origin",
      value: "*",
    });

    const manifest = JSON.parse(readFileSync(`${publicDirectory}/manifest.json`, "utf8")) as {
      name: string;
      iconPath: string;
      safe_apps_permissions: unknown[];
    };
    expect(manifest.name).toBe("Telligence");
    expect(manifest.safe_apps_permissions).toEqual([]);
    expect(() => readFileSync(`${publicDirectory}${manifest.iconPath}`)).not.toThrow();
    expect(readFileSync(`${publicDirectory}${manifest.iconPath}`, "utf8")).toContain(
      'viewBox="0 0 64 64"',
    );
  });
});
