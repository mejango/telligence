import { currentStageIndex } from "@/app/[slug]/owners/components/splitsLib";
import { clearExtensionSalt, saltForExtension } from "@/lib/suckerExtensionSalt";
import { beforeEach, describe, expect, it } from "vitest";

const ALICE = "0x1111111111111111111111111111111111111111" as const;
const BOB = "0x2222222222222222222222222222222222222222" as const;

// `JBController` distributes from the CURRENT ruleset, so an edit aimed at a past stage's
// ruleset id succeeds on-chain and changes nothing. The previous derivation used
// `findIndex(start > now)`, which returns -1 exactly when the LAST stage is current — pinning
// every operator edit to stage 1 for the rest of the revnet's life.
describe("currentStageIndex", () => {
  const stages = [{ start: 100 }, { start: 200 }, { start: 300 }];

  it("selects the last stage that has started", () => {
    expect(currentStageIndex(stages, 150)).toBe(0);
    expect(currentStageIndex(stages, 250)).toBe(1);
  });

  it("stays on the final stage once every stage has started", () => {
    // The regression: this returned 0 for all time after the last stage began.
    expect(currentStageIndex(stages, 350)).toBe(2);
    expect(currentStageIndex(stages, 10_000_000)).toBe(2);
  });

  it("treats a stage starting exactly now as started", () => {
    expect(currentStageIndex(stages, 300)).toBe(2);
  });

  it("floors at the first stage before anything has started, and handles empties", () => {
    expect(currentStageIndex(stages, 1)).toBe(0);
    expect(currentStageIndex([], 500)).toBe(0);
    expect(currentStageIndex(undefined, 500)).toBe(0);
  });

  it("accepts bigint starts as the indexer returns them", () => {
    expect(currentStageIndex([{ start: 100n }, { start: 200n }], 250)).toBe(1);
  });
});

// JBSuckerRegistry derives each sucker address from keccak256(sender, salt)
// (JBSuckerRegistry.sol:1043) — the same-address peer invariant. An extension writes to
// several chains in sequence and stops at the first failure (ALWAYS on the Safe path), so a
// fresh salt on retry would deploy the remaining peers where the existing ones can never
// pair, stranding them.
describe("saltForExtension", () => {
  beforeEach(() => window.localStorage.clear());

  it("reuses the same salt across retries of one attempt", () => {
    const first = saltForExtension(ALICE, 3n, 8453);
    expect(saltForExtension(ALICE, 3n, 8453)).toBe(first);
  });

  it("issues a fresh salt per project and per target chain", () => {
    const base = saltForExtension(ALICE, 3n, 8453);
    expect(saltForExtension(ALICE, 4n, 8453)).not.toBe(base);
    expect(saltForExtension(ALICE, 3n, 10)).not.toBe(base);
  });

  it("does not share a salt between senders", () => {
    // The derivation includes the sender, so another wallet's suckers land elsewhere
    // regardless — reusing the salt would only disguise that.
    const alice = saltForExtension(ALICE, 3n, 8453);
    expect(saltForExtension(BOB, 3n, 8453)).not.toBe(alice);
  });

  it("starts fresh once the completed attempt is cleared", () => {
    const first = saltForExtension(ALICE, 3n, 8453);
    clearExtensionSalt(ALICE, 3n, 8453);
    expect(saltForExtension(ALICE, 3n, 8453)).not.toBe(first);
  });

  it("returns a 32-byte hex salt", () => {
    expect(saltForExtension(ALICE, 3n, 8453)).toMatch(/^0x[0-9a-f]{64}$/i);
  });
});
