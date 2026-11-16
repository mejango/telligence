import { operatorWriteRoute } from "@/app/[slug]/components/v6/operator/operatorLib";
import type { AuthorityIdentity } from "@bananapus/nana-sdk-core/safe";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const SAFE = "0x3333333333333333333333333333333333333333" as Address;

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
  modules: [],
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

  it("wallet-action:operator-writes proposes to the operator Safe when the connected account co-signs it", () => {
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
    // An EIP-7702 delegated operator is an EOA: its own key signs, never this wallet.
    expect(() =>
      operatorWriteRoute({
        account: SIGNER,
        authority: OTHER,
        identity: { kind: "delegated-eoa", delegation: SAFE },
      }),
    ).toThrow(/operator \(0x2222222222222222222222222222222222222222\)\. Connect the operator\.$/);
    expect(() =>
      operatorWriteRoute({ account: SIGNER, authority: OTHER, identity: { kind: "contract" } }),
    ).toThrow(/contract this app cannot act for/);
  });
});
