import { getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "revnet:view-as:v1";
const VIEWED = "0x000000000000000000000000000000000000bEEF" as Address;
const VIEWED_CHECKSUMMED = getAddress(VIEWED);

async function freshViewAsModule() {
  vi.resetModules();
  return import("@/lib/view-as");
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("view-as store", () => {
  it("sets, persists, notifies, and clears the viewed address", async () => {
    const viewAs = await freshViewAsModule();
    const listener = vi.fn();
    const unsubscribe = viewAs.subscribeViewAs(listener);

    expect(viewAs.viewAsSnapshot()).toBeNull();

    viewAs.setViewAs(VIEWED);
    expect(viewAs.viewAsSnapshot()).toBe(VIEWED_CHECKSUMMED);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(VIEWED_CHECKSUMMED);
    expect(listener).toHaveBeenCalledTimes(1);

    viewAs.clearViewAs();
    expect(viewAs.viewAsSnapshot()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    viewAs.setViewAs(VIEWED);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("hydrates a persisted address and normalizes its checksum", async () => {
    window.localStorage.setItem(STORAGE_KEY, VIEWED.toLowerCase());
    const viewAs = await freshViewAsModule();
    expect(viewAs.viewAsSnapshot()).toBe(VIEWED_CHECKSUMMED);
  });

  it("ignores invalid persisted values and invalid set attempts", async () => {
    window.localStorage.setItem(STORAGE_KEY, "not-an-address");
    const viewAs = await freshViewAsModule();
    expect(viewAs.viewAsSnapshot()).toBeNull();

    viewAs.setViewAs("0x123" as Address);
    expect(viewAs.viewAsSnapshot()).toBeNull();
  });

  it("refuses writes only while active", async () => {
    const viewAs = await freshViewAsModule();
    expect(() => viewAs.requireNoViewAs()).not.toThrow();

    viewAs.setViewAs(VIEWED);
    expect(() => viewAs.requireNoViewAs()).toThrowError(viewAs.VIEW_AS_WRITE_ERROR);

    viewAs.clearViewAs();
    expect(() => viewAs.requireNoViewAs()).not.toThrow();
  });
});
