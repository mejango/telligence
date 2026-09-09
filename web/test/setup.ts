import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { installNativeDialogShim, resetNativeDialogShim } from "./native-dialog-shim";

// Route handlers run in the node environment, where there is no DOM to shim.
const hasDom = typeof window !== "undefined";

if (hasDom) installNativeDialogShim(window);

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
});
