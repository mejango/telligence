import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/check-client-bundle.mjs");
const rootChunk = "static/chunks/main.js";
const pageChunk = "static/chunks/page.js";
const defaultFiles = {
  [rootChunk]: 'globalThis.rootChunk = "root";',
  [pageChunk]: 'globalThis.pageChunk = "page";',
};
const directories: string[] = [];

function fixture({
  chunks = [pageChunk],
  rootMainFiles = [rootChunk],
  files = defaultFiles,
}: {
  chunks?: unknown[];
  rootMainFiles?: string[];
  files?: Record<string, string>;
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "revnet-client-bundle-"));
  directories.push(directory);
  const write = (file: string, content: string) => {
    const path = join(directory, ".next", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  write("build-manifest.json", JSON.stringify({ rootMainFiles }));
  write("app-path-routes-manifest.json", JSON.stringify({ "/page": "/" }));
  write(
    "server/app/page_client-reference-manifest.js",
    `globalThis.__RSC_MANIFEST["/page"]=${JSON.stringify({ clientModules: { page: { chunks } } })};`,
  );
  for (const [file, source] of Object.entries(files)) write(file, source);
  return {
    run: (budgets: Record<string, string> = {}) => {
      const result = spawnSync(process.execPath, [script], {
        cwd: directory,
        env: {
          ...process.env,
          CLIENT_ROUTE_GZIP_BUDGET_KIB: "900",
          CLIENT_TOTAL_GZIP_BUDGET_KIB: "1100",
          CLIENT_ALL_JS_GZIP_BUDGET_KIB: "2600",
          ...budgets,
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      if (result.error) throw result.error;
      return { status: result.status, output: result.stdout + result.stderr };
    },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("production client bundle manifest URLs", () => {
  it.each(["?dpl=browser-test", "#chunk", "?dpl=browser-test#chunk", "#chunk?dpl=browser-test"])(
    "counts route and root chunks with suffix %s using the actual checker",
    (suffix) => {
      const result = fixture({
        rootMainFiles: [rootChunk + suffix],
        chunks: [123, "456", pageChunk + suffix, "static/chunks/page.css?dpl=browser-test"],
      }).run();
      expect(result.status).toBe(0);
      expect(result.output).toContain("Largest app route: /");
      expect(result.output).toContain(
        "Budgets: 900 KiB per route, 1100 KiB route-referenced, 2600 KiB all client JavaScript",
      );
    },
  );

  it("deduplicates plain, encoded, query and hash references for both route and unique budgets", () => {
    const exactBytes = Object.values(defaultFiles).reduce(
      (total, source) => total + gzipSync(source, { level: 9 }).byteLength,
      0,
    );
    const result = fixture({
      rootMainFiles: [rootChunk, `${rootChunk}?dpl=one`, `${rootChunk}#root`],
      chunks: [
        pageChunk,
        `${pageChunk}?dpl=one`,
        `${pageChunk}?dpl=two#hash`,
        "static/chunks/%70age.js",
        `${rootChunk}?dpl=other`,
      ],
    }).run({
      CLIENT_ROUTE_GZIP_BUDGET_KIB: String(exactBytes / 1024),
      CLIENT_TOTAL_GZIP_BUDGET_KIB: String(exactBytes / 1024),
      CLIENT_ALL_JS_GZIP_BUDGET_KIB: String(exactBytes / 1024),
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      `Unique app JavaScript: ${(exactBytes / 1024).toFixed(1)} KiB gzip`,
    );
  });

  it("decodes filenames once after removing URL decorations", () => {
    const result = fixture({
      chunks: ["static/chunks/app/%5Bslug%5D/percent%2525%23name.js?dpl=%broken#hash"],
      files: {
        [rootChunk]: defaultFiles[rootChunk],
        "static/chunks/app/[slug]/percent%25#name.js": defaultFiles[pageChunk],
      },
    }).run();
    expect(result.status).toBe(0);
  });

  it.each([
    ["WalletConnect", "walletconnect.org"],
    ["Coinbase Wallet", "CoinbaseWalletSDK"],
    ["Safe", "SafeAppProvider"],
  ])("still rejects eager %s SDKs referenced through decorated or encoded URLs", (name, marker) => {
    const result = fixture({
      chunks: [`${pageChunk}?dpl=browser-test`, "static/chunks/%76endor.js?dpl=browser-test#sdk"],
      files: { ...defaultFiles, "static/chunks/vendor.js": `globalThis.vendor = "${marker}";` },
    }).run();
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${name} SDK is eagerly loaded: static/chunks/vendor.js`);
  });

  it("still recognizes vendor SDK chunks that are only lazy-loaded", () => {
    const result = fixture({
      chunks: [`${pageChunk}?dpl=browser-test`],
      files: {
        ...defaultFiles,
        "static/chunks/vendor.js": 'globalThis.vendor = "SafeAppProvider";',
      },
    }).run();
    expect(result.status).toBe(0);
    expect(result.output).toContain("Safe SDK is lazy-loaded");
  });

  it.each([
    ["CLIENT_ROUTE_GZIP_BUDGET_KIB", "(budget 0 KiB)"],
    ["CLIENT_TOTAL_GZIP_BUDGET_KIB", "unique app JavaScript is"],
    ["CLIENT_ALL_JS_GZIP_BUDGET_KIB", "all client JavaScript is"],
  ])("still enforces %s after URL normalization", (budget, message) => {
    const result = fixture({ chunks: [`${pageChunk}?dpl=browser-test`] }).run({ [budget]: "0" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Client bundle budget exceeded:");
    expect(result.output).toContain(message);
  });

  it("reports a missing decorated chunk instead of dropping its route", () => {
    const result = fixture({ chunks: ["static/chunks/missing.js?dpl=browser-test"] }).run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("missing client asset: static/chunks/missing.js");
    expect(result.output).not.toContain("contains no app routes");
  });

  it.each([
    "../outside.js?dpl=browser-test",
    "%2e%2e/outside.js#hash",
    "/outside.js?dpl=browser-test",
  ])("rejects assets outside the build directory: %s", (asset) => {
    const result = fixture({ chunks: [asset] }).run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("client asset outside .next");
  });
});
