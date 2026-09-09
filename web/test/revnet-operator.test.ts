import {
  JB_PERMISSIONS_DEPLOYMENT_BLOCKS,
  MAX_OPERATOR_HISTORY_CANDIDATES,
  MAX_OPERATOR_HISTORY_LOGS_PER_WINDOW,
  findCurrentRevnetOperator,
  findRevnetOperatorFromPermissionHistory,
  pickRevnetOperator,
  revnetOperatorCandidates,
} from "@/lib/revnetOperator";
import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const CURRENT = "0x1111111111111111111111111111111111111111";
const PREVIOUS = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";

describe("revnet operator selection", () => {
  it("prefers the operator that still holds permissions", () => {
    expect(
      pickRevnetOperator([
        { operator: PREVIOUS, permissions: [], isRevnetOperator: true },
        { operator: CURRENT, permissions: [1, 2], isRevnetOperator: true },
      ]),
    ).toBe(CURRENT);
  });

  it("uses the role-marked row while permission indexing catches up", () => {
    expect(
      pickRevnetOperator([{ operator: CURRENT, permissions: null, isRevnetOperator: true }]),
    ).toBe(CURRENT);
  });

  it("rejects invalid and explicitly non-operator rows", () => {
    expect(
      pickRevnetOperator([
        { operator: "not-an-address", permissions: [1], isRevnetOperator: true },
        { operator: PREVIOUS, permissions: [1], isRevnetOperator: false },
        { operator: ZERO, permissions: [1], isRevnetOperator: true },
      ]),
    ).toBeNull();
  });

  it("deduplicates candidates and live-checks past a stale row", async () => {
    const candidates = revnetOperatorCandidates([
      { operator: PREVIOUS, permissions: [1], isRevnetOperator: true },
      { operator: PREVIOUS, permissions: [1], isRevnetOperator: true },
      { operator: CURRENT, permissions: [1], isRevnetOperator: true },
      { operator: ZERO, permissions: [1], isRevnetOperator: true },
    ]);
    expect(candidates).toEqual([PREVIOUS, CURRENT]);

    const checked: string[] = [];
    await expect(
      findCurrentRevnetOperator(candidates, async (candidate) => {
        checked.push(candidate);
        return candidate === CURRENT;
      }),
    ).resolves.toBe(CURRENT);
    expect(checked).toEqual([PREVIOUS, CURRENT]);
  });

  it("keeps lagging role flags as live-check candidates", () => {
    expect(
      revnetOperatorCandidates([
        { operator: CURRENT, permissions: [], isRevnetOperator: false },
        { operator: ZERO, permissions: [1], isRevnetOperator: true },
      ]),
    ).toEqual([CURRENT]);
  });

  it("recovers the newest non-revoked operator from canonical permission history", async () => {
    const deployment = JB_PERMISSIONS_DEPLOYMENT_BLOCKS[8453];
    const permissions = "0xf92ac1ab5a00033e35a3975739124f61928c36b0";
    const revOwner = "0x2ba4705ad0332cdfb299b452068438bcba3faaf3";
    const getLogs = vi.fn().mockResolvedValue([
      {
        args: { operator: PREVIOUS, packed: 1n },
        blockNumber: deployment + 1n,
        logIndex: 0,
      },
      {
        args: { operator: PREVIOUS, packed: 0n },
        blockNumber: deployment + 3n,
        logIndex: 1,
      },
      {
        args: { operator: ZERO, packed: 1n },
        blockNumber: deployment + 4n,
        logIndex: 0,
      },
      {
        args: { operator: CURRENT, packed: 1n },
        blockNumber: deployment + 2n,
        logIndex: 0,
      },
    ]);
    const accept = vi.fn(async (candidate: string) => candidate === CURRENT);

    await expect(
      findRevnetOperatorFromPermissionHistory({
        client: { getLogs } as unknown as PublicClient,
        chainId: 8453,
        permissions,
        revOwner,
        projectId: 42n,
        throughBlock: deployment + 10n,
        accept,
      }),
    ).resolves.toBe(CURRENT);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(CURRENT);
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: permissions,
        args: { account: revOwner, projectId: 42n },
        fromBlock: deployment,
        toBlock: deployment + 10n,
      }),
    );
  });

  it("fails closed when one permission-history block exceeds the result budget", async () => {
    const deployment = JB_PERMISSIONS_DEPLOYMENT_BLOCKS[1];
    const getLogs = vi.fn().mockResolvedValue(
      Array.from({ length: MAX_OPERATOR_HISTORY_LOGS_PER_WINDOW + 1 }, (_, index) => ({
        args: { operator: CURRENT, packed: 1n },
        blockNumber: deployment,
        logIndex: index,
      })),
    );
    const accept = vi.fn().mockResolvedValue(true);

    await expect(
      findRevnetOperatorFromPermissionHistory({
        client: { getLogs } as unknown as PublicClient,
        chainId: 1,
        permissions: "0xf92ac1ab5a00033e35a3975739124f61928c36b0",
        revOwner: "0x2ba4705ad0332cdfb299b452068438bcba3faaf3",
        projectId: 1n,
        throughBlock: deployment,
        accept,
      }),
    ).resolves.toBeNull();
    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
  });

  it("caps distinct permission-history candidates before live checks amplify", async () => {
    const deployment = JB_PERMISSIONS_DEPLOYMENT_BLOCKS[1];
    const getLogs = vi.fn().mockResolvedValue(
      Array.from({ length: MAX_OPERATOR_HISTORY_CANDIDATES + 1 }, (_, index) => ({
        args: {
          operator: `0x${(index + 1).toString(16).padStart(40, "0")}`,
          packed: 1n,
        },
        blockNumber: deployment,
        logIndex: index,
      })),
    );
    const accept = vi.fn().mockResolvedValue(false);

    await expect(
      findRevnetOperatorFromPermissionHistory({
        client: { getLogs } as unknown as PublicClient,
        chainId: 1,
        permissions: "0xf92ac1ab5a00033e35a3975739124f61928c36b0",
        revOwner: "0x2ba4705ad0332cdfb299b452068438bcba3faaf3",
        projectId: 1n,
        throughBlock: deployment,
        accept,
      }),
    ).resolves.toBeNull();
    expect(accept).toHaveBeenCalledTimes(MAX_OPERATOR_HISTORY_CANDIDATES);
  });
});
