import { resetSafeRelayrForTests, resetWriteHoldsForTests } from "@bananapus/nana-sdk-core/testing";
import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { installNativeDialogShim, resetNativeDialogShim } from "./native-dialog-shim";

// Route handlers run in the node environment, where there is no DOM to shim.
const hasDom = typeof window !== "undefined";

if (hasDom) installNativeDialogShim(window);

// findBy*/waitFor default to 1s, which the full suite exceeds under parallel load;
// keep it under the 10s test timeout so a real hang still fails.
configure({ asyncUtilTimeout: 4_000 });

function blockedNetworkConstructor(transport: string) {
  return class {
    constructor(url?: string | URL) {
      throw new Error(
        `Unexpected ${transport} connection in a deterministic unit test: ${String(url ?? "unknown URL")}. Stub the transport explicitly for this test.`,
      );
    }
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      throw new Error(
        `Unexpected network request in a deterministic unit test: ${url}. Stub fetch explicitly for this test.`,
      );
    }),
  );
  vi.stubGlobal("XMLHttpRequest", blockedNetworkConstructor("XMLHttpRequest"));
  vi.stubGlobal("WebSocket", blockedNetworkConstructor("WebSocket"));
  vi.stubGlobal("EventSource", blockedNetworkConstructor("EventSource"));
});

afterEach(() => {
  if (hasDom) {
    cleanup();
    resetNativeDialogShim();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // The SDK keeps holds, their followers and Safe Relayr watches tab-wide, which the module
  // reset between tests does not reach.
  resetWriteHoldsForTests();
  resetSafeRelayrForTests();
});
