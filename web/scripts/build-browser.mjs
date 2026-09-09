import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import browserProject from "../test/fixtures/browser-project.json" with { type: "json" };

const fixtureOrigin = `http://127.0.0.1:${browserProject.fixturePort}`;
const fixtureRpc = `${fixtureOrigin}/rpc`;
const environment = {
  ...process.env,
  NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${browserProject.appPort}`,
  NEXT_PUBLIC_BENDYSTRAW_URL: fixtureOrigin,
  NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL: fixtureOrigin,
  NEXT_PUBLIC_PARA_API_KEY: "deterministic-browser-key",
  NEXT_PUBLIC_PARA_ENV: "BETA",
  NEXT_PUBLIC_VERSION: "browser-test",
  NEXT_PUBLIC_RPC_FIXTURE_URL: fixtureRpc,
};

function run(command, args) {
  const result = spawnSync(command, args, { env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status ?? 1}`);
  }
}

run(process.execPath, ["scripts/validate-env.mjs", "build"]);
// The release validator rejects this test-only mode. Enable it only after the
// production-shaped public environment above has passed validation.
environment.NEXT_PUBLIC_DETERMINISTIC_BROWSER = "true";
// A prior Next data cache could otherwise hide whether this build actually
// exercised the deterministic contract-derived fixture.
rmSync(new URL("../.next/cache", import.meta.url), { recursive: true, force: true });

const fixture = spawn(process.execPath, ["scripts/browser-fixture-server.mjs"], {
  env: environment,
  stdio: "inherit",
});
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (fixture.exitCode !== null) {
      throw new Error(`Browser fixture exited before build (status ${fixture.exitCode})`);
    }
    try {
      const response = await fetch(`${fixtureOrigin}/healthz`, {
        signal: AbortSignal.timeout(250),
      });
      if (response.ok) break;
    } catch {
      // The child has not bound the loopback listener yet.
    }
    if (attempt === 49) throw new Error("Browser fixture did not become ready for the build");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  run(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"]);
  const statusResponse = await fetch(`${fixtureOrigin}/__fixture/status`, {
    signal: AbortSignal.timeout(1_000),
  });
  if (!statusResponse.ok) throw new Error("Browser fixture status was unavailable after build");
  const status = await statusResponse.json();
  if (status.unknownRequests?.length) {
    throw new Error(
      `Production build made unsupported fixture requests: ${JSON.stringify(status.unknownRequests)}`,
    );
  }
  // Discovery reads fresh gateway capacity in the browser. The build verifies
  // the product shell; Playwright verifies the directory and capacity states.
  const homepage = readFileSync(new URL("../.next/server/app/index.html", import.meta.url), "utf8");
  if (!homepage.includes("Throw money") || !homepage.includes("telligence")) {
    throw new Error("Production build did not prerender the Telligence homepage");
  }
} finally {
  fixture.kill("SIGTERM");
}
