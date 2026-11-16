import {
  useSafeBatchSubmit,
  type SafeBatchRoute,
} from "@/app/[slug]/components/v6/operator/useSafeBatchSubmit";
import { SAFE_PROPOSAL_PENDING_LINE } from "@/lib/reviewed-call";
import { buildStep, composeBatch } from "@/lib/safe-batch";
import { safeExecutionIntent } from "@/lib/write-hold";
import type { ReviewedAction } from "@bananapus/nana-sdk-core/review";
import { safeBatchProposalFor, safeTransactionHash } from "@bananapus/nana-sdk-core/safe-service";
import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeChain } from "./fixtures/safe-chain";

// A signer of the operator Safe on a chain with no Safe transaction service
// approves (or executes) the batch's SafeTx hash onchain.

const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const SAFE = "0x3333333333333333333333333333333333333333" as Address;
const HOOK = "0xB222Da5A71e8FB89a5A38b7c920EaB5DfbC74B91" as Address;

const mocks = vi.hoisted(() => ({
  safe: false,
  account: "0x1111111111111111111111111111111111111111" as string,
  approved: [] as `0x${string}`[],
  write: vi.fn(),
  run: undefined as unknown as import("vitest").Mock,
}));

vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: mocks.account, chainId: 8453 }),
  getPublicClient: () => undefined,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/safe-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-connector")>()),
  isSafeConnection: () => mocks.safe,
}));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionThrough } = await import("./support/reviewed-action");
  const runner = reviewedActionThrough(mocks.write, { proposed: () => mocks.safe });
  mocks.run = runner.run;
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: runner.hook,
  };
});
vi.mock("@bananapus/nana-sdk-core/safe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/safe")>()),
  readAuthorityIdentity: async () => ({ kind: "safe", owners: [SIGNER, OTHER], threshold: 2 }),
  readBoundedSafeNonce: async () => 3n,
}));
vi.mock("@bananapus/nana-sdk-core/safe-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/safe-service")>()),
  hasSafeService: () => false,
}));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", () => ({
  chainName: () => "Base",
  operatorWriteRoute: vi.fn(),
  runSequentialWrites: vi.fn(),
  publicClientFor: () => ({
    // Owners' approvals of the batch hash, read as bounded eth_calls on the Safe.
    ...safeChain(SAFE, { approvedBy: mocks.approved }).client,
    getCode: async () => "0x6080",
    simulateCalls: async ({ calls }: { calls: unknown[] }) => ({
      results: calls.map(() => ({ status: "success" })),
    }),
  }),
}));

const steps = [
  buildStep({ kind: "setHookFor", chainId: 8453, projectId: 2, values: { hook: HOOK } }),
];
const route: SafeBatchRoute = {
  kind: "safe-signer",
  safe: SAFE,
  owners: [SIGNER, OTHER],
  threshold: 2,
};

async function submit() {
  const { result } = renderHook(() => useSafeBatchSubmit());
  return act(() =>
    result.current.submit({
      chainId: 8453,
      steps,
      route,
      onProgress: vi.fn(),
      onStep: vi.fn(),
    }),
  );
}

beforeEach(() => {
  mocks.safe = false;
  mocks.account = SIGNER;
  mocks.approved = [];
  mocks.run.mockClear();
  mocks.write.mockReset();
  mocks.write.mockResolvedValue(`0x${"ab".repeat(32)}`);
});

const run = (safe: boolean) =>
  safe ? expect(submit()).rejects.toThrow(SAFE_PROPOSAL_PENDING_LINE) : submit();
const action = () => mocks.run.mock.calls[0][0] as ReviewedAction;

describe("onchain Safe batch approval", () => {
  it.each([
    ["an EOA signer", false],
    ["a Safe signer", true],
  ])("reviews %s's approveHash with the batch it approves", async (_, safe) => {
    mocks.safe = safe;
    await run(safe);

    expect(mocks.run).toHaveBeenCalledOnce();
    expect(action().confirmLabel).toBe("Agree & approve onchain");
    expect(action().calls).toHaveLength(1);
    expect(action().calls[0]).toMatchObject({ to: SAFE, functionName: "approveHash" });
    expect(action().calls[0]!.gas).toBeUndefined();
    expect(action().context?.[0]?.lines).toEqual([`1. ${steps[0].label}`]);
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ address: SAFE, functionName: "approveHash" }),
      expect.anything(),
    );
  });

  it("reviews a Safe signer's execTransaction as a Safe proposal", async () => {
    mocks.safe = true;
    mocks.approved = [OTHER];
    await run(true);

    expect(action().confirmLabel).toBe("Agree & execute");
    expect(action().calls[0]).toMatchObject({ functionName: "execTransaction" });
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  describe("when this owner's approval meets the threshold", () => {
    const safeTxHash = safeTransactionHash(
      8453,
      SAFE,
      safeBatchProposalFor(composeBatch(steps).calls, 3),
    );
    const approvedHead = (owner: Address) =>
      `${owner.slice(2).toLowerCase().padStart(64, "0")}${"0".repeat(64)}01`;

    beforeEach(() => {
      mocks.approved = [OTHER];
    });

    it("executes with pre-validated signatures in ascending owner order, held by its Safe transaction", async () => {
      await expect(submit()).resolves.toMatchObject({ kind: "executed", calls: 1 });
      expect(mocks.write).toHaveBeenCalledOnce();
      const [sent] = mocks.write.mock.calls[0];
      expect(sent).toMatchObject({ address: SAFE, functionName: "execTransaction" });
      expect(sent.args[9]).toBe(`0x${approvedHead(SIGNER)}${approvedHead(OTHER)}`);
      // Core counts an execTransaction done only on the Safe's own success for this hash.
      expect(action().calls[0]!.intent).toBe(safeExecutionIntent(8453, SAFE, safeTxHash));
    });
  });

  it("sends nothing when the signer leaves the Safe after review", async () => {
    mocks.account = "0x4444444444444444444444444444444444444444";
    await expect(submit()).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
