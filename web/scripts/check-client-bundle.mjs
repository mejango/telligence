import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const routeBudgetKiB = Number(process.env.CLIENT_ROUTE_GZIP_BUDGET_KIB ?? 900);
const totalBudgetKiB = Number(process.env.CLIENT_TOTAL_GZIP_BUDGET_KIB ?? 1100);
// Counts every emitted chunk, including ones a visitor may never download.
// WalletConnect (with @reown/appkit), Coinbase Wallet and Safe add ~690 KiB of
// strictly lazy vendor SDK here; the per-route budgets and the lazy-load
// assertions at the bottom of this file are what protect first paint.
const allClientBudgetKiB = Number(process.env.CLIENT_ALL_JS_GZIP_BUDGET_KIB ?? 2600);
const routeBudget = routeBudgetKiB * 1024;
const totalBudget = totalBudgetKiB * 1024;
const allClientBudget = allClientBudgetKiB * 1024;
const buildDirectory = resolve(process.cwd(), ".next");
const buildManifestPath = resolve(buildDirectory, "build-manifest.json");
const appRoutesManifestPath = resolve(buildDirectory, "app-path-routes-manifest.json");
const clientReferenceDirectory = resolve(buildDirectory, "server", "app");

for (const manifestPath of [buildManifestPath, appRoutesManifestPath]) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing ${manifestPath}. Run \`npm run build\` before this check.`);
  }
}

const gzipSizes = new Map();

function javascriptAsset(asset) {
  if (typeof asset !== "string") return null;
  // Next appends deployment IDs to chunk URLs. URL decorations are not part
  // of the emitted filename or its identity for budgets and lazy SDK checks.
  // Decode only after removing the suffix, so encoded filename characters
  // remain part of the path and are never treated as URL delimiters.
  const pathname = decodeURIComponent(asset.split(/[?#]/u, 1)[0]);
  if (!pathname.endsWith(".js")) return null;
  const relativePath = relative(buildDirectory, resolve(buildDirectory, pathname));
  if (
    isAbsolute(pathname) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`The build manifest references a client asset outside .next: ${asset}`);
  }
  return relativePath.split(sep).join("/");
}

function gzipSize(relativePath) {
  const cached = gzipSizes.get(relativePath);
  if (cached !== undefined) return cached;

  const absolutePath = resolve(buildDirectory, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`The build manifest references a missing client asset: ${relativePath}`);
  }
  const size = gzipSync(readFileSync(absolutePath), { level: 9 }).byteLength;
  gzipSizes.set(relativePath, size);
  return size;
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
const appRoutes = JSON.parse(readFileSync(appRoutesManifestPath, "utf8"));
const rootMainFiles = [
  ...new Set((buildManifest.rootMainFiles ?? []).map(javascriptAsset).filter(Boolean)),
];
const pages = Object.fromEntries(
  filesBelow(clientReferenceDirectory)
    .filter((file) => file.endsWith("_client-reference-manifest.js"))
    .map((file) => {
      const source = readFileSync(file, "utf8");
      const assignment = source.match(/globalThis\.__RSC_MANIFEST\[("(?:\\.|[^"\\])*")\]=/u);
      if (!assignment || assignment.index === undefined) {
        throw new Error(`Could not read the client reference manifest: ${file}`);
      }

      const appPath = JSON.parse(assignment[1]);
      const manifest = JSON.parse(
        source.slice(assignment.index + assignment[0].length).replace(/;\s*$/u, ""),
      );
      const routeAssets = Object.values(manifest.clientModules ?? {}).flatMap(
        (module) => module.chunks ?? [],
      );
      const javascript = [...new Set(routeAssets.map(javascriptAsset).filter(Boolean))];

      return [appRoutes[appPath] ?? appPath, [...new Set([...rootMainFiles, ...javascript])]];
    })
    .filter(([, assets]) => assets.length > rootMainFiles.length),
);

const routes = Object.entries(pages)
  .map(([route, assets]) => {
    const javascript = [...new Set(assets.filter((asset) => asset.endsWith(".js")))];
    return {
      route,
      size: javascript.reduce((total, asset) => total + gzipSize(asset), 0),
    };
  })
  .sort((left, right) => right.size - left.size);

if (routes.length === 0) {
  throw new Error("The client build manifest contains no app routes.");
}

const totalSize = [...gzipSizes.values()].reduce((total, size) => total + size, 0);
const allClientFiles = filesBelow(resolve(buildDirectory, "static", "chunks")).filter((file) =>
  file.endsWith(".js"),
);
if (allClientFiles.length === 0) {
  throw new Error("The production build contains no client JavaScript chunks.");
}
const allClientSize = allClientFiles.reduce(
  (total, file) => total + gzipSync(readFileSync(file), { level: 9 }).byteLength,
  0,
);
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const largest = routes[0];

console.log(`Largest app route: ${largest.route} (${kib(largest.size)} gzip)`);
console.log(`Unique app JavaScript: ${kib(totalSize)} gzip`);
console.log(`All client JavaScript: ${kib(allClientSize)} gzip`);
console.log(
  `Budgets: ${routeBudgetKiB} KiB per route, ${totalBudgetKiB} KiB route-referenced, ${allClientBudgetKiB} KiB all client JavaScript`,
);

const failures = [];
for (const route of routes.filter((entry) => entry.size > routeBudget)) {
  failures.push(`${route.route} is ${kib(route.size)} (budget ${routeBudgetKiB} KiB)`);
}
if (totalSize > totalBudget) {
  failures.push(`unique app JavaScript is ${kib(totalSize)} (budget ${totalBudgetKiB} KiB)`);
}
if (allClientSize > allClientBudget) {
  failures.push(
    `all client JavaScript is ${kib(allClientSize)} (budget ${allClientBudgetKiB} KiB)`,
  );
}

// Wagmi's `reconnect()` calls `getProvider()` on every configured connector, so
// a vendor wallet SDK becomes an eager download the moment its `shouldRestore`
// gate is dropped. Markers must be strings only the vendor bundle can contain —
// never a connector id or display name, which our own source carries.
const vendorWallets = [
  ["WalletConnect", ["walletconnect.org", "wc@2:", "@reown/appkit"]],
  ["Coinbase Wallet", ["CoinbaseWalletSDK", "keys.coinbase.com", "walletlink"]],
  ["Safe", ["safe-apps-provider", "SafeAppProvider"]],
];
for (const [label, markers] of vendorWallets) {
  const vendorAssets = new Set(
    allClientFiles
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return markers.some((marker) => source.includes(marker));
      })
      .map((file) => relative(buildDirectory, file).split(sep).join("/")),
  );
  if (vendorAssets.size === 0) continue;
  const eager = Object.values(pages)
    .flat()
    .filter((asset) => vendorAssets.has(asset));
  if (eager.length > 0) {
    failures.push(`${label} SDK is eagerly loaded: ${[...new Set(eager)].join(", ")}`);
  } else {
    console.log(`${label} SDK is lazy-loaded`);
  }
}

if (failures.length > 0) {
  throw new Error(`Client bundle budget exceeded:\n- ${failures.join("\n- ")}`);
}
