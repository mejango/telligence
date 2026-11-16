import { UnverifiedSuckerError } from "@bananapus/nana-sdk-core/v6";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registered: vi.fn(),
  readContract: vi.fn(),
  call: vi.fn(),
}));

vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: () => ({ readContract: mocks.readContract, call: mocks.call }),
}));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getRegisteredSucker: mocks.registered,
  classifySuckerTransport: async () => "native",
}));

import { prepareQueuedExecute, type V6BridgeRow } from "@/lib/v6/suckerProofs";

const INDEXED = "0x1111111111111111111111111111111111111111" as Address;
const REGISTERED = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN = "0x000000000000000000000000000000000000EEEe" as Address;
const ACCOUNT = "0x3333333333333333333333333333333333333333" as Address;
const row = {
  chainId: 10,
  projectId: 7n,
  peerChainId: 8453,
  sourceSucker: INDEXED,
  token: TOKEN,
} as V6BridgeRow;

beforeEach(() => {
  mocks.registered.mockReset();
  mocks.readContract.mockReset().mockResolvedValue(5n);
  mocks.call.mockReset().mockResolvedValue({ data: "0x" });
});

describe("a queued movement's Execute", () => {
  it("quotes and sends toRemote to the registry's sucker, never the indexer's", async () => {
    mocks.registered.mockResolvedValueOnce(REGISTERED);
    const prepared = await prepareQueuedExecute(row, ACCOUNT);
    expect(mocks.registered).toHaveBeenCalledWith(expect.anything(), {
      chainId: 10,
      projectId: 7n,
      remoteChainId: 8453,
      sucker: INDEXED,
    });
    expect(prepared).toEqual({ sucker: REGISTERED, value: 5n });
    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ to: REGISTERED }));
  });

  it("stops before any fee read when the registry does not list the sucker", async () => {
    mocks.registered.mockRejectedValueOnce(new UnverifiedSuckerError("unregistered"));
    await expect(prepareQueuedExecute(row, ACCOUNT)).rejects.toBeInstanceOf(UnverifiedSuckerError);
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
