import browserProject from "../../test/fixtures/browser-project.json" with { type: "json" };

const appPort = browserProject.appPort;
export const appOrigin = `http://127.0.0.1:${appPort}`;
const fixturePort = browserProject.fixturePort;
export const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;

/** The runtime environment of the deterministic browser build, served against the fixture. */
export const deterministicEnvironment = {
  NEXT_PUBLIC_VERSION: "browser-test",
  HOSTNAME: "127.0.0.1",
  NEXT_PUBLIC_SITE_URL: appOrigin,
  NEXT_PUBLIC_BENDYSTRAW_URL: fixtureOrigin,
  NEXT_PUBLIC_DETERMINISTIC_BROWSER: "true",
  NEXT_PUBLIC_PARA_API_KEY: "deterministic-browser-key",
  NEXT_PUBLIC_PARA_ENV: "BETA",
  NEXT_PUBLIC_RPC_FIXTURE_URL: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL: fixtureOrigin,
  PORT: String(appPort),
};
