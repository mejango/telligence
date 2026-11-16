import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/check-client-bundle.mjs");
// test/setup.ts blocks fetch in tests; the checker runs as a child process, so only
// this file's loopback HTML server is reached.
const rootChunk = "static/chunks/main.js";
const pageChunk = "static/chunks/page.js";
const polyfill = "static/chunks/polyfills.js";
const defaultFiles: Record<string, string> = {
  [rootChunk]: 'globalThis.rootChunk = "root";',
  [pageChunk]: 'globalThis.pageChunk = "page";',
  [polyfill]: `globalThis.polyfill = "${randomBytes(3000).toString("hex")}";`,
};
const gz = (source: string) => gzipSync(source, { level: 9 }).byteLength;
const directories: string[] = [];
const servers: Server[] = [];

/** A page as Next renders it: script tags, a nomodule polyfill and the RSC payload. */
function page(chunks: string[] = [pageChunk]) {
  const flight = JSON.stringify(chunks.map((chunk) => `/_next/${chunk}?dpl=browser-test`));
  return `<!DOCTYPE html><html><head>
<script src="/_next/${polyfill}" noModule=""></script>
<script src="/_next/${rootChunk}?dpl=browser-test" async=""></script>
</head><body><script>self.__next_f.push([1,"1:I[1,${flight.replace(/"/gu, '\\"').replace(/\//gu, "\\u002F")}]"])</script></body></html>`;
}

function fixture({
  files = defaultFiles,
  pages = { "/": page() } as Record<string, string | { status: number; html: string }>,
  appRoutes = { "/page": "/" } as Record<string, string>,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "revnet-client-bundle-"));
  directories.push(directory);
  const write = (file: string, content: string) => {
    const path = join(directory, ".next", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  write("app-path-routes-manifest.json", JSON.stringify(appRoutes));
  for (const [file, source] of Object.entries(files)) write(file, source);
  return {
    write,
    /** A route only the deterministic browser build compiles. */
    addProofRoute(route: string) {
      const dir = join(directory, "src", "app", ...route.split("/").filter(Boolean));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "page.browsertest.tsx"), "export default function Proof() {}\n");
    },
    async run(
      routes: { route: string; path: string; kib: number; status?: number }[] = [
        { route: "/", path: "/", kib: 900 },
      ],
      budgets: Record<string, string> = {},
    ) {
      const server = createServer((request, response) => {
        const entry = pages[request.url ?? ""];
        if (entry === undefined) return void response.writeHead(404).end("missing");
        const { status, html } = typeof entry === "string" ? { status: 200, html: entry } : entry;
        response.writeHead(status, { "content-type": "text/html" }).end(html);
      });
      servers.push(server);
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const { port } = server.address() as AddressInfo;
      const child = spawn(process.execPath, [script], {
        cwd: directory,
        env: {
          ...process.env,
          CLIENT_BUNDLE_ORIGIN: `http://127.0.0.1:${port}`,
          CLIENT_BUNDLE_ROUTES: JSON.stringify(routes),
          CLIENT_TOTAL_GZIP_BUDGET_KIB: "1100",
          CLIENT_ALL_JS_GZIP_BUDGET_KIB: "2600",
          ...budgets,
        },
      });
      let output = "";
      child.stdout.on("data", (data) => (output += data));
      child.stderr.on("data", (data) => (output += data));
      const status = await new Promise<number | null>((done) => child.on("close", done));
      return { status, output };
    },
  };
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("rendered-HTML client bundle check", () => {
  it("counts each script tag and RSC payload chunk once, without nomodule polyfills", async () => {
    const exact = gz(defaultFiles[rootChunk]) + gz(defaultFiles[pageChunk]);
    const result = await fixture().run([{ route: "/", path: "/", kib: exact / 1024 }], {
      CLIENT_TOTAL_GZIP_BUDGET_KIB: String(exact / 1024),
    });
    expect(result.output).toContain("2 chunks  / (/)");
    expect(result.output).toContain(
      `Route-referenced JavaScript: ${(exact / 1024).toFixed(1)} KiB`,
    );
    expect(result.status).toBe(0);
  });

  it("still counts a chunk a module script loads when a nomodule tag names it too", async () => {
    const result = await fixture({ pages: { "/": page([pageChunk, polyfill]) } }).run();
    expect(result.output).toContain("3 chunks  / (/)");
    expect(result.status).toBe(0);
  });

  it("fails a route over its ceiling", async () => {
    const result = await fixture().run([{ route: "/", path: "/", kib: 0 }]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("/ loads");
    expect(result.output).toContain("(budget 0 KiB)");
  });

  it("measures a route another route's leak reaches, which manifests miss", async () => {
    const leak = "static/chunks/home.js";
    const result = await fixture({
      files: {
        ...defaultFiles,
        [leak]: `globalThis.home = "${randomBytes(3000).toString("hex")}";`,
      },
      pages: { "/": page(), "/x": page([pageChunk, leak]) },
      appRoutes: { "/page": "/", "/[slug]/page": "/[slug]" },
    }).run([
      { route: "/", path: "/", kib: 1 },
      { route: "/[slug]", path: "/x", kib: 1 },
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("/[slug] loads");
    expect(result.output).not.toMatch(/^- \/ loads/mu);
  });

  it("requires every shipped page route to have a budget, but not proof routes", async () => {
    const checked = fixture({
      appRoutes: {
        "/page": "/",
        "/shop/page": "/shop",
        "/proof/page": "/proof",
        "/api/x/route": "/api/x",
      },
    });
    checked.addProofRoute("/proof");
    const result = await checked.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("/shop is a shipped page with no rendered-HTML budget");
    expect(result.output).not.toContain("/proof is");
    expect(result.output).not.toContain("/api/x is");
  });

  it("checks each route's status, so a 404 page is measured as a 404", async () => {
    const result = await fixture({
      pages: { "/": page(), "/gone": { status: 404, html: page() } },
    }).run([
      { route: "/", path: "/", kib: 900 },
      { route: "/_not-found", path: "/gone", kib: 900, status: 404 },
      { route: "/", path: "/missing", kib: 900 },
    ]);
    expect(result.output).toContain("/_not-found (/gone)");
    expect(result.output).toContain("/missing answered 404, expected 200");
    expect(result.status).toBe(1);
  });

  it.each([
    ["WalletConnect", "walletconnect.org"],
    ["Coinbase Wallet", "CoinbaseWalletSDK"],
    ["Safe", "SafeAppProvider"],
  ])("rejects an eager %s SDK a page references", async (name, marker) => {
    const vendor = "static/chunks/vendor.js";
    const result = await fixture({
      files: { ...defaultFiles, [vendor]: `globalThis.vendor = "${marker}";` },
      pages: { "/": page([pageChunk, vendor]) },
    }).run();
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${name} SDK is eagerly loaded: ${vendor}`);
  });

  it("accepts a vendor SDK chunk no page references", async () => {
    const result = await fixture({
      files: {
        ...defaultFiles,
        "static/chunks/vendor.js": 'globalThis.vendor = "SafeAppProvider";',
      },
    }).run();
    expect(result.output).toContain("Safe SDK is not in any route's HTML");
    expect(result.status).toBe(0);
  });

  it("enforces the all-client JavaScript ceiling", async () => {
    const result = await fixture().run(undefined, { CLIENT_ALL_JS_GZIP_BUDGET_KIB: "0" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("all client JavaScript is");
  });

  it("reports a referenced chunk missing from the build", async () => {
    const result = await fixture({ pages: { "/": page(["static/chunks/missing.js"]) } }).run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("missing client asset: static/chunks/missing.js");
  });

  it("rejects a reference outside the build directory", async () => {
    const result = await fixture({
      pages: { "/": '<script src="/_next/static/chunks/../../../outside.js"></script>' },
    }).run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("client asset outside .next");
  });
});
