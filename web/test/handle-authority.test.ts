import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  creationService,
  provenSafe,
  SAFE_OWNER_A,
  safeChain,
  type SafeFixture,
} from "./fixtures/safe-chain";

const SAFE = provenSafe();
// The module caches creation records per chain and Safe; each test starts with none.
let readHandleAuthority: typeof import("@/lib/handle-authority").readHandleAuthority;
let unprovenSafeMessage: typeof import("@/lib/handle-authority").unprovenSafeMessage;
beforeEach(async () => {
  vi.resetModules();
  ({ readHandleAuthority, unprovenSafeMessage } = await import("@/lib/handle-authority"));
});
const EOA = "0x1111111111111111111111111111111111111111" as Address;
const MODULE = "0x6666666666666666666666666666666666666666" as Address;
const DELEGATED_EOA_CODE = `0xef0100${MODULE.slice(2)}` as Hex;

/** A Base project whose authority is `safe` on Base and on Ethereum. */
function onBaseAndEthereum(safe: SafeFixture = SAFE) {
  return {
    sourceChainId: 8453,
    sourceClient: safeChain(safe.address).client,
    mainnetClient: safeChain(safe.address).client,
    authority: safe.address,
  };
}

describe("project handle authority across chains", () => {
  it("trusts a Safe on Ethereum with the creation record from its project chain's Safe service", async () => {
    const service = creationService(SAFE, "base");
    vi.stubGlobal("fetch", service);

    await expect(readHandleAuthority(onBaseAndEthereum())).resolves.toMatchObject({
      status: "valid-safe",
      allowed: true,
      creation: SAFE.creation,
    });
    // Only the project chain's record: Ethereum's service is never asked.
    expect(service).toHaveBeenCalledTimes(1);
    expect(String(service.mock.calls[0][0])).toBe(
      `https://juicebox.center/v1/safe/base/api/v1/safes/${SAFE.address}/creation/`,
    );
  });

  it.each([
    ["the service fails", vi.fn(async () => new Response("unavailable", { status: 503 }))],
    ["the service is unreachable", vi.fn(async () => Promise.reject(new Error("offline")))],
    [
      "the record is another Safe's",
      vi.fn(async () => new Response(JSON.stringify(provenSafe({ saltNonce: 8n }).servicePayload))),
    ],
  ])("leaves the Safe unproven when %s", async (_case, service) => {
    vi.stubGlobal("fetch", service);

    await expect(readHandleAuthority(onBaseAndEthereum())).resolves.toMatchObject({
      status: "unproven-creation",
      allowed: false,
    });
    expect(service).toHaveBeenCalled();
  });

  it("leaves the Safe unproven, asking no service, on a chain Safe hosts no service for", async () => {
    const service = vi.fn();
    vi.stubGlobal("fetch", service);

    await expect(
      readHandleAuthority({ ...onBaseAndEthereum(), sourceChainId: 11155420 }),
    ).resolves.toMatchObject({ status: "unproven-creation", allowed: false, creation: null });
    expect(service).not.toHaveBeenCalled();
  });

  it("reads EOAs, contracts and Ethereum authorities without asking the Safe service", async () => {
    const service = vi.fn();
    vi.stubGlobal("fetch", service);
    const eoa = safeChain(null).client;
    const delegated = { ...eoa, getCode: vi.fn(async () => DELEGATED_EOA_CODE) } as typeof eoa;
    const contract = safeChain(null, { contracts: [EOA] }).client;

    for (const [sourceClient, mainnetClient, status] of [
      [eoa, eoa, "valid-eoa"],
      [delegated, eoa, "valid-eoa"],
      [eoa, delegated, "valid-eoa"],
      [contract, eoa, "source-contract"],
      [eoa, contract, "mainnet-contract"],
    ] as const) {
      await expect(
        readHandleAuthority({ sourceChainId: 10, sourceClient, mainnetClient, authority: EOA }),
      ).resolves.toMatchObject({ status, creation: null });
    }
    await expect(
      readHandleAuthority({
        sourceChainId: 1,
        sourceClient: contract,
        mainnetClient: contract,
        authority: EOA,
      }),
    ).resolves.toMatchObject({ status: "valid-local", allowed: true });
    expect(service).not.toHaveBeenCalled();
  });

  it("keeps a Safe's own policy checks ahead of its creation record", async () => {
    vi.stubGlobal("fetch", creationService(SAFE, "base"));
    const base = (options = {}) => safeChain(SAFE.address, options).client;

    for (const [sourceClient, mainnetClient, status] of [
      // Not on Ethereum yet: deployable at the same address, and the record is kept for that.
      [base(), safeChain(null).client, "missing-mainnet-safe"],
      [base(), base({ threshold: 1 }), "authority-mismatch"],
      [base({ modules: [MODULE] }), base({ modules: [MODULE] }), "unsafe-safe-policy"],
      [base(), base({ contracts: [SAFE_OWNER_A] }), "contract-owner"],
    ] as const) {
      await expect(
        readHandleAuthority({
          sourceChainId: 8453,
          sourceClient,
          mainnetClient,
          authority: SAFE.address,
        }),
      ).resolves.toMatchObject({ status, allowed: false, creation: SAFE.creation });
    }
  });

  it("pins both chains' reads to the blocks it is given", async () => {
    vi.stubGlobal("fetch", creationService(SAFE, "base"));
    const source = safeChain(SAFE.address);
    const mainnet = safeChain(SAFE.address);

    await readHandleAuthority({
      sourceChainId: 8453,
      sourceClient: source.client,
      mainnetClient: mainnet.client,
      authority: SAFE.address,
      sourceBlockNumber: 200n,
      mainnetBlockNumber: 100n,
    });
    expect(source.getCode.mock.calls.map(([args]) => args)).toEqual(
      source.getCode.mock.calls.map(() => expect.objectContaining({ blockNumber: 200n })),
    );
    expect(mainnet.getCode.mock.calls.map(([args]) => args)).toEqual(
      mainnet.getCode.mock.calls.map(() => expect.objectContaining({ blockNumber: 100n })),
    );
  });

  it("reads a proven creation record once, and a missing one again after a minute", async () => {
    vi.useFakeTimers();
    const proven = creationService(SAFE, "base");
    vi.stubGlobal("fetch", proven);
    for (let check = 0; check < 3; check += 1) {
      await expect(readHandleAuthority(onBaseAndEthereum())).resolves.toMatchObject({
        status: "valid-safe",
      });
    }
    // The record proves the Safe's address, which never changes.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await readHandleAuthority(onBaseAndEthereum());
    expect(proven).toHaveBeenCalledTimes(1);

    const other = provenSafe({ saltNonce: 9n });
    const missing = vi.fn(async () => new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", missing);
    await readHandleAuthority(onBaseAndEthereum(other));
    await readHandleAuthority(onBaseAndEthereum(other));
    expect(missing).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(readHandleAuthority(onBaseAndEthereum(other))).resolves.toMatchObject({
      status: "unproven-creation",
    });
    expect(missing).toHaveBeenCalledTimes(2);
  });

  it("gives up on a creation request that does not answer within 4 seconds", async () => {
    vi.useFakeTimers();
    // A request that answers only when it is aborted, as fetch does.
    const hung = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    vi.stubGlobal("fetch", hung);
    let settled = false;
    const check = readHandleAuthority(onBaseAndEthereum()).then((authority) => {
      settled = true;
      return authority;
    });

    await vi.advanceTimersByTimeAsync(3_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(check).resolves.toMatchObject({ status: "unproven-creation" });
    expect(hung).toHaveBeenCalledOnce();
  });

  it("asks the Safe service once for checks of one Safe that start together", async () => {
    const proven = creationService(SAFE, "base");
    vi.stubGlobal("fetch", proven);

    const checks = await Promise.all([1, 2, 3].map(() => readHandleAuthority(onBaseAndEthereum())));

    expect(checks.map((check) => check.status)).toEqual(["valid-safe", "valid-safe", "valid-safe"]);
    expect(proven).toHaveBeenCalledTimes(1);
  });

  it("reads the project chain's authority once per check of an authority that is not a Safe", async () => {
    const source = safeChain(null);
    await readHandleAuthority({
      sourceChainId: 10,
      sourceClient: source.client,
      mainnetClient: safeChain(null).client,
      authority: EOA,
    });
    expect(source.getCode).toHaveBeenCalledTimes(1);
  });

  it("names the chain a Safe can't be verified on in one line", () => {
    expect(unprovenSafeMessage(1)).toBe("Can't verify this Safe is the same on Ethereum.");
  });
});
