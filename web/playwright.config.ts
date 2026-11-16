import { defineConfig } from "@playwright/test";
import {
  appOrigin,
  deterministicEnvironment,
  fixtureOrigin,
} from "./scripts/lib/browser-environment.mjs";

export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: appOrigin,
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 900 } } },
    { name: "wide-1100", use: { viewport: { width: 1100, height: 900 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "narrow-320", use: { viewport: { width: 320, height: 568 } } },
  ],
  webServer: [
    {
      command: "npm run browser:fixture",
      url: `${fixtureOrigin}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run standalone:stage && npm run start:standalone",
      url: `${appOrigin}/create`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: deterministicEnvironment,
    },
  ],
});
