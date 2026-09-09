import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONNECTED = "0x000000000000000000000000000000000000dEaD" as Address;
const VIEWED = "0x000000000000000000000000000000000000bEEF" as Address;

const wallet = vi.hoisted(() => ({
  address: undefined as Address | undefined,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: wallet.address }),
}));

async function freshModules() {
  vi.resetModules();
  const [viewAsLib, hook] = await Promise.all([
    import("@/lib/view-as"),
    import("@/hooks/useViewedAccount"),
  ]);
  return { viewAsLib, hook };
}

beforeEach(() => {
  window.localStorage.clear();
  wallet.address = CONNECTED;
});

describe("useViewedAccount", () => {
  it("returns the connected account when view-as is inactive", async () => {
    const { hook } = await freshModules();
    const { result } = renderHook(() => hook.useViewedAccount());
    expect(result.current).toEqual({
      address: CONNECTED,
      connectedAddress: CONNECTED,
      isViewAs: false,
    });
  });

  it("overrides the displayed address while view-as is active, keeping the connected one", async () => {
    const { viewAsLib, hook } = await freshModules();
    const { result } = renderHook(() => hook.useViewedAccount());

    act(() => viewAsLib.setViewAs(VIEWED));
    expect(result.current).toEqual({
      address: VIEWED,
      connectedAddress: CONNECTED,
      isViewAs: true,
    });

    act(() => viewAsLib.clearViewAs());
    expect(result.current).toEqual({
      address: CONNECTED,
      connectedAddress: CONNECTED,
      isViewAs: false,
    });
  });

  it("works for a disconnected visitor", async () => {
    wallet.address = undefined;
    const { viewAsLib, hook } = await freshModules();
    const { result } = renderHook(() => hook.useViewedAccount());
    expect(result.current.address).toBeUndefined();

    act(() => viewAsLib.setViewAs(VIEWED));
    expect(result.current).toEqual({
      address: VIEWED,
      connectedAddress: undefined,
      isViewAs: true,
    });
  });
});
