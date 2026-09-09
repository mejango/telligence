// Safe execution requires every owner signature concatenated in ASCENDING NUMERIC owner
// order, and accepts EIP-1271 contract-signer signatures alongside 65-byte ECDSA ones.
import { usableSafeConfirmations } from "@/lib/safe-queue";
import { describe, expect, it } from "vitest";

const tx = (confirmations: { owner: string; signature?: string }[]) =>
  ({ confirmations }) as Parameters<typeof usableSafeConfirmations>[0];

const ecdsa = `0x${"11".repeat(65)}`;
const contractSig = `0x${"22".repeat(97)}`; // EIP-1271: longer than 65 bytes

describe("usableSafeConfirmations", () => {
  it("keeps EIP-1271 contract-signer confirmations", () => {
    // The old exact-130-hex filter dropped these, so a Safe owned by a smart account
    // under-counted its threshold and could never execute.
    const kept = usableSafeConfirmations(
      tx([{ owner: "0x1111111111111111111111111111111111111111", signature: contractSig }]),
    );
    expect(kept).toHaveLength(1);
  });

  it("still keeps ordinary ECDSA confirmations", () => {
    const kept = usableSafeConfirmations(
      tx([{ owner: "0x1111111111111111111111111111111111111111", signature: ecdsa }]),
    );
    expect(kept).toHaveLength(1);
  });

  it("rejects malformed or too-short signatures", () => {
    expect(
      usableSafeConfirmations(
        tx([{ owner: "0x1111111111111111111111111111111111111111", signature: "0xdeadbeef" }]),
      ),
    ).toHaveLength(0);
  });

  it("sorts owners numerically, not as strings", () => {
    // "0x9…" > "0xa…" as a string but < numerically; a string sort yields GS026.
    const sorted = usableSafeConfirmations(
      tx([
        { owner: "0xaaaa111111111111111111111111111111111111", signature: ecdsa },
        { owner: "0x9999111111111111111111111111111111111111", signature: ecdsa },
      ]),
    );
    expect(sorted.map((c) => c.owner[2])).toEqual(["9", "a"]);
    expect(BigInt(sorted[0].owner)).toBeLessThan(BigInt(sorted[1].owner));
  });
});
