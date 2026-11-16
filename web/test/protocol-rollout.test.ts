import { protocolQueueLabel } from "@/lib/protocol-queue-label";
import {
  readRouterPath,
  rolloutAddress,
  rolloutChain,
  rolloutContractName,
  rolloutTargets,
} from "@/lib/protocol-rollout";
import { routerGatewayAbi } from "@/lib/router-gateway-abi";
import { mirrorBatch } from "@/lib/safe-batch";
import {
  MIGRATION_MIRROR_LINE,
  resolvePreset,
  SAFE_BATCH_PRESETS,
  stepResolverFor,
  type PresetReadClient,
} from "@/lib/safe-batch-presets";
import {
  jbBuybackHookAbi,
  jbRouterTerminalAbi,
  jbRouterTerminalRegistryAbi,
} from "@bananapus/nana-sdk-core";
import { encodeFunctionData, zeroAddress, zeroHash, type Address, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const chainId = 84532;
const targets = rolloutTargets(chainId)!;
function client(terminal: Address, attached = true) {
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "isTerminalOf") return attached;
    if (functionName === "terminalOf") return terminal;
    if (functionName === "ROUTER") return rolloutAddress("JBRouterTerminal", chainId);
    throw new Error(functionName);
  });
  return { client: { readContract } as unknown as PublicClient, readContract };
}

describe("canonical router rollout", () => {
  it.each([1, 10, 8453, 42161])(
    "prepares the executed mainnet migration on chain %s from its own state, never by mirroring",
    async (destination) => {
      const reader = {
        getCode: vi.fn(async () => "0x6001"),
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "isHookAllowed" || functionName === "isTerminalAllowed") return true;
          if (functionName === "hookOf" || functionName === "terminalOf") return zeroAddress;
          if (functionName === "currentRulesetOf") return [{ id: 1 }, {}];
          if (functionName === "splitsOf") return [];
          throw new Error(`Unexpected migration read: ${functionName}`);
        }),
      } as unknown as PresetReadClient;
      const preset = await resolvePreset(SAFE_BATCH_PRESETS[0]!, {
        chainId,
        projectId: 2,
        client: reader,
      });
      if (preset.status !== "ready") throw new Error(preset.message);
      const mirrored = await mirrorBatch(
        preset.steps,
        chainId,
        { chainId: destination, projectId: 2 },
        stepResolverFor(() => reader),
      );
      expect(mirrored.steps).toEqual([]);
      expect(mirrored.skipped.map((item) => item.reason)).toEqual([
        MIGRATION_MIRROR_LINE,
        MIGRATION_MIRROR_LINE,
      ]);
      const own = await resolvePreset(SAFE_BATCH_PRESETS[0]!, {
        chainId: destination,
        projectId: 2,
        client: reader,
      });
      if (own.status !== "ready") throw new Error(own.message);
      expect(own.steps.map((step) => [step.kind, step.values])).toEqual([
        ["setHookFor", { hook: rolloutAddress("JBBuybackHook", destination) }],
        ["setTerminalFor", { terminal: rolloutAddress("JBRouterTerminalGateway", destination) }],
      ]);
    },
  );
  it("derives readiness from each chain's canonical records, allowing data-only activation", () => {
    for (const id of [1, 10, 8453, 42161, 11155420, 11155111, 84532, 421614]) {
      const hook = rolloutAddress("JBBuybackHook", id);
      const terminal = rolloutAddress("JBRouterTerminalGateway", id);
      expect(rolloutTargets(id)).toEqual(hook && terminal ? { hook, terminal } : null);
    }
  });
  it("resolves the selected gateway and its immutable router", async () => {
    const stub = client(targets.terminal);
    expect(await readRouterPath(stub.client, chainId, 2n)).toMatchObject({
      gateway: targets.terminal,
      router: rolloutAddress("JBRouterTerminal", chainId),
    });
  });
  it("preserves a project's previous router selection after the chain upgrades", async () => {
    const previous = rolloutChain(chainId)!.history.JBRouterTerminal!.previous as Address;
    const stub = client(previous);
    expect(await readRouterPath(stub.client, chainId, 2n)).toMatchObject({
      gateway: null,
      router: previous,
    });
    expect(stub.readContract).toHaveBeenCalledTimes(2);
    expect(rolloutContractName(chainId, previous)).toBe("JBRouterTerminal (previous)");
  });
  it("does not infer routing from defaults when the registry is not attached", async () => {
    const stub = client(targets.terminal, false);
    expect(await readRouterPath(stub.client, chainId, 2n)).toBeNull();
    expect(stub.readContract).toHaveBeenCalledTimes(1);
  });
  it("does not invent an underlying router for an unknown selected terminal", async () => {
    const stub = client("0x1111111111111111111111111111111111111111");
    expect(await readRouterPath(stub.client, chainId, 2n)).toMatchObject({
      gateway: null,
      router: null,
    });
  });
  it("keeps an unreadable gateway router unknown", async () => {
    const stub = client(targets.terminal);
    stub.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "isTerminalOf") return true;
      if (functionName === "terminalOf") return targets.terminal;
      throw new Error("RPC unavailable");
    });
    expect(await readRouterPath(stub.client, chainId, 2n)).toMatchObject({
      gateway: targets.terminal,
      router: null,
    });
  });
});

describe("protocol queue labels", () => {
  it("decodes a retained-call retry only at the recorded gateway", () => {
    const call = {
      amount: 100n,
      preferAddToBalance: false,
      shouldReturnHeldFees: false,
      beneficiary: zeroAddress,
      projectId: 1n,
      refundTo: zeroAddress,
      sourceProjectId: 2n,
      token: zeroAddress,
    };
    const data = encodeFunctionData({
      abi: routerGatewayAbi,
      functionName: "processPendingCall",
      args: [zeroHash, call, "retained fee", "0x"],
    });
    expect(protocolQueueLabel(chainId, { to: targets.terminal, data, operation: 0 })).toBe(
      "JBRouterTerminalGateway (current).processPendingCall",
    );
  });
  it("preserves previous-router payment labels in the Safe queue", () => {
    const previous = rolloutChain(chainId)!.history.JBRouterTerminal!.previous as Address;
    const data = encodeFunctionData({
      abi: jbRouterTerminalAbi,
      functionName: "pay",
      args: [2n, zeroAddress, 100n, zeroAddress, 0n, "", "0x"],
    });
    expect(protocolQueueLabel(chainId, { to: previous, data, operation: 0 })).toBe(
      "JBRouterTerminal (previous).pay",
    );
  });
  it("labels gateway selection and retains historical hook labels", () => {
    const data = encodeFunctionData({
      abi: jbRouterTerminalRegistryAbi,
      functionName: "setTerminalFor",
      args: [2n, targets.terminal],
    });
    const tx = { to: rolloutAddress("JBRouterTerminalRegistry", chainId)!, data, operation: 0 };
    expect(protocolQueueLabel(chainId, tx)).toContain("JBRouterTerminalGateway (current)");
    expect(
      protocolQueueLabel(chainId, { ...tx, to: "0x1111111111111111111111111111111111111111" }),
    ).toBeNull();
    expect(protocolQueueLabel(chainId, { ...tx, operation: 1 })).toBeNull();
    const previous = rolloutChain(chainId)!.history.JBBuybackHook!.previous as Address;
    const twap = encodeFunctionData({
      abi: jbBuybackHookAbi,
      functionName: "setTwapWindowOf",
      args: [2n, "0x0000000000000000000000000000000000000000", 1800n],
    });
    expect(protocolQueueLabel(chainId, { to: previous, data: twap, operation: 0 })).toBe(
      "JBBuybackHook (previous).setTwapWindowOf",
    );
  });
});
