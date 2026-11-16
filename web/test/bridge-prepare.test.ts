import {
  bridgeReclaimMinimum,
  buildProtectedBridgePrepareTx,
  cashOutProtocolFee,
  protectedOutputFloor,
  quoteBridgePrepare,
  slippagePercentToBps,
} from "@/lib/bridgePrepare";
import { pad, PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyDestinationMint: vi.fn() }));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  verifySuckerDestinationMint: mocks.verifyDestinationMint,
}));

const SUCKER = "0x1111111111111111111111111111111111111111";
const BENEFICIARY = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const PEER = "0x5555555555555555555555555555555555555555";

function bridgeClients() {
  const getChainId = vi.fn(async () => 1);
  const readContract = vi.fn(async (request: { functionName: string }) => {
    switch (request.functionName) {
      case "suckerPairsOf":
        return [{ local: SUCKER, remote: pad(PEER), remoteChainId: 10n }];
      case "previewCashOutFrom":
        return [{}, 1_000n, 1n, []];
      case "feeFreeSurplusOf":
        return 0n;
      case "FEELESS_ADDRESSES":
        return "0x4444444444444444444444444444444444444444";
      case "accountingContextForTokenOf":
        return { token: TOKEN, decimals: 6, currency: 1 };
      case "isFeelessFor":
        return false;
      default:
        throw new Error(`Unexpected read: ${request.functionName}`);
    }
  });
  const destinationRead = vi.fn(async (request: { functionName: string }): Promise<unknown> => {
    if (request.functionName === "projectId") return 8n;
    if (request.functionName === "suckerPairsOf") {
      return [{ local: PEER, remote: pad(SUCKER), remoteChainId: 1n }];
    }
    throw new Error(`Unexpected destination read: ${request.functionName}`);
  });
  return {
    client: { readContract, getChainId } as unknown as PublicClient,
    destinationClient: { readContract: destinationRead } as unknown as PublicClient,
    readContract,
    destinationRead,
    getChainId,
  };
}

const quoteArgs = {
  chainId: 1,
  projectId: 7n,
  sucker: SUCKER,
  projectTokenCount: 10n ** 18n,
  terminalToken: TOKEN,
  slippageBps: 100n,
  destinationChainId: 10,
  destinationProjectId: 8n,
  destinationSucker: pad(PEER),
  beneficiary: BENEFICIARY,
} as const;

beforeEach(() => {
  mocks.verifyDestinationMint.mockResolvedValue(undefined);
});

describe("protected bridge preparation", () => {
  it("mirrors the contract's standard fee branches and rounding", () => {
    expect(
      cashOutProtocolFee({
        reclaimAmount: 1_001n,
        cashOutTaxRate: 1n,
        beneficiaryIsFeeless: false,
        feeFreeSurplus: 0n,
      }),
    ).toBe(25n);
    expect(
      cashOutProtocolFee({
        reclaimAmount: 1_001n,
        cashOutTaxRate: 0n,
        beneficiaryIsFeeless: false,
        feeFreeSurplus: 400n,
      }),
    ).toBe(10n);
    expect(
      cashOutProtocolFee({
        reclaimAmount: 1_001n,
        cashOutTaxRate: 1n,
        beneficiaryIsFeeless: true,
        feeFreeSurplus: 1_001n,
      }),
    ).toBe(0n);
  });

  it("uses a user-selected, floor-rounded tolerance", () => {
    expect(slippagePercentToBps("1")).toBe(100n);
    expect(slippagePercentToBps("0.25")).toBe(25n);
    expect(protectedOutputFloor(1_001n, 100n)).toBe(990n);
    expect(() => slippagePercentToBps("1.234")).toThrow(/at most two decimal places/u);
    expect(() => slippagePercentToBps("5.01")).toThrow(/cannot exceed 5%/u);
    expect(bridgeReclaimMinimum(0n, 100n)).toBe(0n);
    expect(bridgeReclaimMinimum(1n, 100n)).toBe(1n);
    expect(bridgeReclaimMinimum(1_001n, 100n)).toBe(990n);
    expect(() => bridgeReclaimMinimum(0n, 10_000n)).toThrow(/less than 100%/u);
    expect(() => protectedOutputFloor(0n, 100n)).toThrow(/no backing/u);
    expect(() => protectedOutputFloor(1_000n, 10_000n)).toThrow(/less than 100%/u);
    expect(() => protectedOutputFloor(1n, 100n)).toThrow(/rounds to zero/u);
  });

  it("wallet-action:bridge-prepare encodes the reviewed nonzero minimum in prepare", () => {
    const request = buildProtectedBridgePrepareTx({
      chainId: 1,
      sucker: SUCKER,
      projectTokenCount: 10n ** 18n,
      beneficiary: BENEFICIARY,
      minTokensReclaimed: 975_000n,
      token: TOKEN,
    });

    expect(request.functionName).toBe("prepare");
    expect(request.args[0]).toBe(10n ** 18n);
    expect(request.args[2]).toBe(975_000n);
    expect(() =>
      buildProtectedBridgePrepareTx({
        chainId: 1,
        sucker: SUCKER,
        projectTokenCount: 0n,
        beneficiary: BENEFICIARY,
        minTokensReclaimed: 975_000n,
        token: TOKEN,
      }),
    ).toThrow(/include project tokens/u);
    expect(
      buildProtectedBridgePrepareTx({
        chainId: 1,
        sucker: SUCKER,
        projectTokenCount: 10n ** 18n,
        beneficiary: BENEFICIARY,
        minTokensReclaimed: 0n,
        token: TOKEN,
      }).args[2],
    ).toBe(0n);
  });

  it("quotes with the same sucker caller context and current three-argument feeless lookup", async () => {
    const { client, destinationClient, readContract, destinationRead } = bridgeClients();
    const quote = await quoteBridgePrepare(client, { ...quoteArgs, destinationClient });

    expect(quote).toEqual({
      grossReclaimAmount: 1_000n,
      netReclaimAmount: 975n,
      minTokensReclaimed: 965n,
      tokenDecimals: 6,
    });
    const previewRead = readContract.mock.calls.find(
      ([request]) => request.functionName === "previewCashOutFrom",
    )?.[0] as { account?: string; args?: readonly unknown[] };
    expect(previewRead.account).toBe(SUCKER);
    expect(previewRead.args?.[0]).toBe(SUCKER);
    expect(previewRead.args?.[4]).toBe(SUCKER);
    const feelessRead = readContract.mock.calls.find(
      ([request]) => request.functionName === "isFeelessFor",
    )?.[0] as { args?: readonly unknown[] };
    expect(feelessRead.args).toEqual([SUCKER, 7n, SUCKER]);
    expect(destinationRead).toHaveBeenCalledWith(
      expect.objectContaining({ address: PEER, functionName: "projectId" }),
    );
    expect(mocks.verifyDestinationMint).toHaveBeenCalledExactlyOnceWith(destinationClient, {
      chainId: 10,
      projectId: 8n,
      sucker: PEER,
      beneficiary: BENEFICIARY,
      tokenCount: 10n ** 18n,
    });
  });

  it("refuses a source preparation quote when the destination cannot mint", async () => {
    const { client, destinationClient } = bridgeClients();
    mocks.verifyDestinationMint.mockRejectedValue(new Error("Destination mint denied"));

    await expect(quoteBridgePrepare(client, { ...quoteArgs, destinationClient })).rejects.toThrow(
      "Destination mint denied",
    );
  });

  it("refuses an unregistered destination even when its peer and mint permission match", async () => {
    const { client, destinationClient, destinationRead } = bridgeClients();
    destinationRead.mockImplementation(async ({ functionName }) => {
      if (functionName === "projectId") return 8n;
      if (functionName === "peer") return pad(SUCKER);
      if (functionName === "peerChainId") return 1n;
      if (functionName === "suckerPairsOf") return [];
      throw new Error(`Unexpected destination read: ${functionName}`);
    });

    await expect(quoteBridgePrepare(client, { ...quoteArgs, destinationClient })).rejects.toThrow(
      "The destination bridge no longer matches",
    );
    expect(mocks.verifyDestinationMint).not.toHaveBeenCalled();
  });

  it("refuses a source RPC on the wrong chain before reading its registry", async () => {
    const { client, destinationClient, getChainId, readContract } = bridgeClients();
    getChainId.mockResolvedValue(10);

    await expect(quoteBridgePrepare(client, { ...quoteArgs, destinationClient })).rejects.toThrow(
      "The source RPC is connected to a different network",
    );
    expect(readContract).not.toHaveBeenCalled();
    expect(mocks.verifyDestinationMint).not.toHaveBeenCalled();
  });

  it("refuses a registered peer for a different destination project than the selected revnet", async () => {
    const { client, destinationClient, destinationRead } = bridgeClients();
    destinationRead.mockResolvedValueOnce(9n);

    await expect(quoteBridgePrepare(client, { ...quoteArgs, destinationClient })).rejects.toThrow(
      "The destination project changed",
    );
    expect(mocks.verifyDestinationMint).not.toHaveBeenCalled();
  });

  it("refuses a route replaced after review before probing a different peer", async () => {
    const { client, destinationClient, readContract } = bridgeClients();
    readContract.mockResolvedValueOnce([
      { local: SUCKER, remote: pad(BENEFICIARY), remoteChainId: 10n },
    ]);

    await expect(quoteBridgePrepare(client, { ...quoteArgs, destinationClient })).rejects.toThrow(
      "The bridge route changed",
    );
    expect(mocks.verifyDestinationMint).not.toHaveBeenCalled();
  });

  it.each(["local", "remote", "remoteChainId"])(
    "refuses a destination registry pair with a different %s",
    async (field) => {
      const { client, destinationClient, destinationRead } = bridgeClients();
      destinationRead.mockImplementation(async ({ functionName }) => {
        if (functionName === "projectId") return 8n;
        return [
          {
            local: field === "local" ? BENEFICIARY : PEER,
            remote: pad(field === "remote" ? BENEFICIARY : SUCKER),
            remoteChainId: field === "remoteChainId" ? 8453n : 1n,
          },
        ];
      });

      await expect(quoteBridgePrepare(client, { ...quoteArgs, destinationClient })).rejects.toThrow(
        "The destination bridge no longer matches",
      );
      expect(mocks.verifyDestinationMint).not.toHaveBeenCalled();
    },
  );
});
