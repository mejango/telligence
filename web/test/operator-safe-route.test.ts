import { operatorWriteRoute } from "@/app/[slug]/components/v6/operator/operatorLib";
import type { AuthorityIdentity } from "@/lib/cross-chain-authority";
import {
  nextProposalNonce,
  proposeSafeTransaction,
  queuedTransactionMatchesCall,
  safeProposalFor,
  safeTransactionHash,
  type SafeQueuedTransaction,
} from "@/lib/safe-queue";
import { getAddress, type Address, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

// wallet-action:operator-writes

const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const SAFE = "0x3333333333333333333333333333333333333333" as Address;
const HOOK = "0x4444444444444444444444444444444444444444" as Address;

const safeIdentity = (owners: Address[]): AuthorityIdentity => ({
  kind: "safe",
  proxyCodeHash: "0x00",
  singleton: OTHER,
  singletonCodeHash: "0x00",
  version: "1.4.1",
  owners,
  threshold: 2,
  fallbackHandler: OTHER,
  fallbackHandlerCodeHash: null,
  guard: OTHER,
  hasModules: false,
  ownersAreEoas: true,
});

describe("operator write routing", () => {
  it("sends directly when the connected account is the operator or the operator is unknown", () => {
    expect(operatorWriteRoute({ account: SIGNER, authority: undefined, identity: null })).toEqual({
      kind: "direct",
    });
    expect(
      operatorWriteRoute({
        account: SIGNER,
        authority: SIGNER.toUpperCase().replace("0X", "0x") as Address,
        identity: { kind: "eoa" },
      }),
    ).toEqual({ kind: "direct" });
  });

  it("proposes to the operator Safe when the connected account co-signs it", () => {
    expect(
      operatorWriteRoute({
        account: SIGNER,
        authority: SAFE,
        identity: safeIdentity([OTHER, SIGNER]),
      }),
    ).toEqual({ kind: "safe-signer", safe: SAFE, owners: [OTHER, SIGNER], threshold: 2 });
  });

  it("refuses a wallet that is neither the operator nor one of its Safe signers", () => {
    expect(() =>
      operatorWriteRoute({ account: SIGNER, authority: SAFE, identity: safeIdentity([OTHER]) }),
    ).toThrow(/not a signer of the operator Safe/);
    expect(() =>
      operatorWriteRoute({ account: SIGNER, authority: OTHER, identity: { kind: "eoa" } }),
    ).toThrow(/not this revnet's operator/);
    expect(() =>
      operatorWriteRoute({ account: SIGNER, authority: OTHER, identity: { kind: "contract" } }),
    ).toThrow(/contract this app cannot act for/);
  });
});

describe("Safe proposal building", () => {
  const call = { to: HOOK, data: "0xabcdef" as Hex, value: 0n };
  const queued = (nonce: number, data: Hex = "0xabcdef"): SafeQueuedTransaction => ({
    ...safeProposalFor({ to: HOOK, data }, nonce),
  });

  it("takes the nonce after everything already queued, never below the Safe's own", () => {
    expect(nextProposalNonce(5, [])).toBe(5);
    expect(nextProposalNonce(5, [queued(5), queued(7)])).toBe(8);
    // A stale queue entry below the Safe's nonce cannot pull the proposal backwards.
    expect(nextProposalNonce(5, [queued(2)])).toBe(5);
  });

  it("matches only the exact call already queued", () => {
    expect(queuedTransactionMatchesCall(queued(5), call)).toBe(true);
    expect(queuedTransactionMatchesCall(queued(5, "0xabcd00"), call)).toBe(false);
    expect(queuedTransactionMatchesCall({ ...queued(5), value: "1" }, call)).toBe(false);
    expect(queuedTransactionMatchesCall({ ...queued(5), operation: 1 }, call)).toBe(false);
  });

  it("shapes a plain zero-gas CALL proposal", () => {
    const tx = safeProposalFor(call, 9);
    expect(tx).toMatchObject({
      to: getAddress(HOOK),
      value: "0",
      data: "0xabcdef",
      operation: 0,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      nonce: 9,
    });
  });
});

describe("Safe proposal submission", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the exact signed payload with checksummed addresses and returns its hash", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const tx = safeProposalFor({ to: HOOK, data: "0xabcdef" }, 9);
    const hash = await proposeSafeTransaction(8453, SAFE, tx, SIGNER, "0x99");

    expect(hash).toBe(safeTransactionHash(8453, SAFE, tx));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.safe.global/tx-service/base/api/v1/safes/${getAddress(SAFE)}/multisig-transactions/`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      to: getAddress(HOOK),
      value: "0",
      data: "0xabcdef",
      operation: 0,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: "9",
      contractTransactionHash: hash,
      sender: getAddress(SIGNER),
      signature: "0x99",
      origin: "revnet.money",
    });
  });

  it("surfaces a service rejection instead of pretending the proposal queued", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Address not checksumed", { status: 422 })),
    );
    await expect(
      proposeSafeTransaction(
        8453,
        SAFE,
        safeProposalFor({ to: HOOK, data: "0x" }, 1),
        SIGNER,
        "0x",
      ),
    ).rejects.toThrow(/422: Address not checksumed/);
  });

  it("refuses chains without a hosted Safe service", async () => {
    await expect(
      proposeSafeTransaction(
        421614,
        SAFE,
        safeProposalFor({ to: HOOK, data: "0x" }, 1),
        SIGNER,
        "0x",
      ),
    ).rejects.toThrow(/unavailable on this chain/);
  });
});
