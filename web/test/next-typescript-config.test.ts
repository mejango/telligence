import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("loads application path aliases through Next's production TypeScript configuration", () => {
  // Use Next's real configuration defaults in a fresh Node process: Vitest's
  // independent @ alias would otherwise conceal a broken production resolver.
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "-e",
      `
        (async () => {
          const loadConfig = require("next/dist/server/config").default;
          const loadJsConfig = require("next/dist/build/load-jsconfig").default;
          const { PHASE_PRODUCTION_BUILD } = require("next/constants");
          const config = await loadConfig(PHASE_PRODUCTION_BUILD, process.cwd(), { silent: true });
          const info = await loadJsConfig(process.cwd(), config);
          process.stdout.write(JSON.stringify({
            useTypeScript: info.useTypeScript,
            paths: info.jsConfig?.compilerOptions.paths,
            baseUrl: info.resolvedBaseUrl?.baseUrl,
          }));
        })().catch((error) => { console.error(error); process.exitCode = 1; });
      `,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 10_000,
    },
  );

  expect(JSON.parse(output)).toMatchObject({
    useTypeScript: true,
    paths: { "@/*": ["./src/*"] },
    baseUrl: resolve(process.cwd()),
  });
});
