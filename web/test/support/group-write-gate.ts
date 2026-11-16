import type { GroupWriteTarget } from "@/lib/nana/groupWriteGate";

/**
 * A stand-in for `useGroupWriteGate` in component tests: every target is
 * chain-verified unless its `chainId:projectId` is listed in `unverified`.
 * Usage: `vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"))`.
 */
export const groupGateState = {
  unverified: [] as string[],
  pending: false,
  reset() {
    this.unverified = [];
    this.pending = false;
  },
};

const keyOf = (target: GroupWriteTarget) => `${target.chainId}:${BigInt(target.projectId)}`;
const unverifiedOf = (list: readonly GroupWriteTarget[]) =>
  list.filter((target) => groupGateState.unverified.includes(keyOf(target)));
const lineFor = (list: readonly GroupWriteTarget[]) =>
  list.length && !groupGateState.pending ? "A project listed here isn't linked onchain." : null;

export function useGroupWriteGate(targets: readonly GroupWriteTarget[]) {
  const unverified = unverifiedOf(targets);
  return {
    checking: groupGateState.pending,
    blocked: unverified.length > 0,
    pending: unverified.length > 0 && groupGateState.pending,
    line: lineFor(unverified),
    unverifiedOf,
    lineFor,
    assertVerified(list: readonly GroupWriteTarget[]) {
      const missing = unverifiedOf(list);
      if (missing.length) throw new Error(lineFor(missing) ?? "Still confirming.");
    },
  };
}
