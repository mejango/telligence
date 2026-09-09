import {
  JB_PROJECT_HANDLES_ADDRESS,
  PROJECT_HANDLE_TEXT_KEY,
  ensTextResolverAbi,
  jbProjectHandlesAbi,
} from "@/lib/projectHandles";
import {
  bindingMatchesProject,
  classifyQueuedProjectHandleTransaction,
  projectSafeQueueTargets,
  verifyQueuedProjectHandlePostcondition,
  verifyQueuedProjectHandleTransaction,
} from "@/lib/queuedProjectHandle";
import type { SafeQueuedTransaction } from "@/lib/safe-queue";
import {
  RevnetCoreContracts,
  getJBContractAddress,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import {
  encodeFunctionData,
  encodeFunctionResult,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";

const SAFE = "0x1111111111111111111111111111111111111111" as Address;
const RESOLVER = "0x2222222222222222222222222222222222222222" as Address;
const OTHER = "0x3333333333333333333333333333333333333333" as Address;
const NODE = `0x${"44".repeat(32)}` as Hex;

function queued(to: Address, data: Hex): SafeQueuedTransaction {
  return {
    to,
    value: "0",
    data,
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: 0,
  };
}

function setTextTx(record = "1:7"): SafeQueuedTransaction {
  return queued(
    RESOLVER,
    encodeFunctionData({
      abi: ensTextResolverAbi,
      functionName: "setText",
      args: [NODE, PROJECT_HANDLE_TEXT_KEY, record],
    }),
  );
}

function setHandleTx(
  chainId: bigint = 8453n,
  projectId: bigint = 42n,
  parts: string[] = ["juicebox", "design"],
): SafeQueuedTransaction {
  return queued(
    JB_PROJECT_HANDLES_ADDRESS,
    encodeFunctionData({
      abi: jbProjectHandlesAbi,
      functionName: "setEnsNamePartsFor",
      args: [chainId, projectId, parts],
    }),
  );
}

function mainnetClient({
  blockNumber = 100n,
  projectId = 7n,
  operator = true,
  owner = getJBContractAddress(RevnetCoreContracts.REVOwner, 6, 1),
  request = vi.fn().mockResolvedValue("0x"),
}: {
  blockNumber?: bigint;
  projectId?: bigint;
  operator?: boolean;
  owner?: Address;
  request?: ReturnType<typeof vi.fn>;
} = {}) {
  const readContract = vi.fn(async (call: { functionName: string; args?: readonly unknown[] }) => {
    if (call.functionName === "ownerOf") {
      expect(call.args).toEqual([projectId]);
      return owner;
    }
    if (call.functionName === "isOperatorOf") return operator;
    if (call.functionName === "resolver") return RESOLVER;
    throw new Error(`Unexpected read ${call.functionName}`);
  });
  return {
    client: {
      getBlockNumber: vi.fn().mockResolvedValue(blockNumber),
      readContract,
      request,
    } as unknown as PublicClient,
    readContract,
    request,
  };
}

describe("queued project-handle classification", () => {
  it("strictly decodes canonical handle writes while leaving unrelated calls alone", () => {
    const ens = classifyQueuedProjectHandleTransaction(1, setTextTx("8453:42"));
    expect(ens).toMatchObject({ kind: "ens-text", value: "8453:42" });

    const handle = classifyQueuedProjectHandleTransaction(1, setHandleTx());
    expect(handle).toMatchObject({
      kind: "project-handle",
      source: { chainId: 8453, projectId: 42n },
      handle: { handle: "design.juicebox", parts: ["juicebox", "design"] },
    });

    expect(classifyQueuedProjectHandleTransaction(8453, setHandleTx())).toBeNull();
    expect(classifyQueuedProjectHandleTransaction(1, queued(OTHER, "0x"))).toBeNull();
    const unrelatedText = queued(
      RESOLVER,
      encodeFunctionData({
        abi: ensTextResolverAbi,
        functionName: "setText",
        args: [NODE, "avatar", "ipfs://example"],
      }),
    );
    expect(classifyQueuedProjectHandleTransaction(1, unrelatedText)).toBeNull();
  });

  it("rejects non-canonical name parts and non-call Safe operations", () => {
    expect(() =>
      classifyQueuedProjectHandleTransaction(1, setHandleTx(8453n, 42n, ["DESIGN"])),
    ).toThrow("not canonical");
    expect(() =>
      classifyQueuedProjectHandleTransaction(1, { ...setTextTx("8453:42"), operation: 1 }),
    ).toThrow("direct Safe calls");
  });

  for (const [callType, makeTransaction] of [
    ["ENS setText", () => setTextTx("8453:42")],
    ["JBProjectHandles", () => setHandleTx()],
  ] as const) {
    it(`${callType} rejects every nonzero or custom Safe reimbursement field`, () => {
      for (const [field, value] of [
        ["safeTxGas", "1"],
        ["baseGas", "1"],
        ["gasPrice", "1"],
        ["gasToken", OTHER],
        ["refundReceiver", OTHER],
      ] as const) {
        expect(() =>
          classifyQueuedProjectHandleTransaction(1, {
            ...makeTransaction(),
            [field]: value,
          }),
        ).toThrow(field);
      }
    });

    it(`${callType} fails closed on malformed and overflowing reimbursement fields`, () => {
      for (const field of ["safeTxGas", "baseGas", "gasPrice"] as const) {
        expect(() =>
          classifyQueuedProjectHandleTransaction(1, {
            ...makeTransaction(),
            [field]: "00",
          }),
        ).toThrow(`malformed ${field}`);
      }
      expect(() =>
        classifyQueuedProjectHandleTransaction(1, {
          ...makeTransaction(),
          safeTxGas: (1n << 256n).toString(),
        }),
      ).toThrow("out-of-range safeTxGas");
      expect(() =>
        classifyQueuedProjectHandleTransaction(1, {
          ...makeTransaction(),
          gasPrice: Number.MAX_SAFE_INTEGER + 1,
        }),
      ).toThrow("malformed gasPrice");
      for (const field of ["gasToken", "refundReceiver"] as const) {
        expect(() =>
          classifyQueuedProjectHandleTransaction(1, {
            ...makeTransaction(),
            [field]: "0x1234" as Address,
          }),
        ).toThrow(`malformed ${field}`);
      }
    });
  }
});

describe("queued project-handle live verification", () => {
  it("drops a setText signature when the Safe's resolver authorization is revoked", async () => {
    const simulation = vi
      .fn()
      .mockResolvedValueOnce("0x")
      .mockRejectedValueOnce(new Error("revoked"));
    const { client } = mainnetClient({ request: simulation });
    const clientFor = vi.fn(() => client);
    const transaction = setTextTx();

    await expect(
      verifyQueuedProjectHandleTransaction({
        executionChainId: 1,
        safe: SAFE,
        transaction,
        clientFor,
      }),
    ).resolves.toMatchObject({ kind: "ens-text" });
    await expect(
      verifyQueuedProjectHandleTransaction({
        executionChainId: 1,
        safe: SAFE,
        transaction,
        clientFor,
      }),
    ).rejects.toThrow("no longer authorized");
    expect(simulation).toHaveBeenLastCalledWith({
      method: "eth_call",
      params: [
        expect.objectContaining({
          from: SAFE,
          to: RESOLVER,
          data: transaction.data,
          gas: "0x7a120",
        }),
        "0x64",
      ],
    });
  });

  it("rejects setText after the encoded project leaves REVOwner even if resolver simulation would pass", async () => {
    const simulation = vi.fn().mockResolvedValue("0x");
    const { client } = mainnetClient({ owner: SAFE, request: simulation });

    await expect(
      verifyQueuedProjectHandleTransaction({
        executionChainId: 1,
        safe: SAFE,
        transaction: setTextTx(),
        clientFor: () => client,
      }),
    ).rejects.toThrow("no longer controlled by canonical REVOwner");
    expect(simulation).not.toHaveBeenCalled();
  });

  it("rejects the encoded L2 tuple after its operator rotates even if a mainnet sibling remains live", async () => {
    const { client: ethereum } = mainnetClient();
    expect(
      projectSafeQueueTargets(
        [
          { chainId: 1, projectId: 7, safe: SAFE },
          { chainId: 8453, projectId: 42, safe: SAFE },
        ],
        { chainId: 8453, projectId: 42 },
      ).find((target) => target.chainId === 1),
    ).toMatchObject({ handleOnly: false, authorityRows: [{ chainId: 1, projectId: 7 }] });
    const sourceRead = vi.fn(async (call: { functionName: string }) => {
      if (call.functionName === "ownerOf") {
        return getJBContractAddress(RevnetCoreContracts.REVOwner, 6, 8453);
      }
      if (call.functionName === "isOperatorOf") return false;
      throw new Error(`Unexpected read ${call.functionName}`);
    });
    const base = {
      getBlockNumber: vi.fn().mockResolvedValue(200n),
      readContract: sourceRead,
    } as unknown as PublicClient;
    const clientFor = (chainId: JBChainId) => (chainId === 1 ? ethereum : base);

    await expect(
      verifyQueuedProjectHandleTransaction({
        executionChainId: 1,
        safe: SAFE,
        transaction: setHandleTx(),
        clientFor,
      }),
    ).rejects.toThrow("no longer the encoded revnet's live operator");
    expect(sourceRead).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "isOperatorOf",
        args: [42n, SAFE],
        blockNumber: 200n,
      }),
    );
  });

  it("never accepts direct Safe ownership after a project leaves canonical REVOwner", async () => {
    const { client: ethereum } = mainnetClient();
    const base = {
      getBlockNumber: vi.fn().mockResolvedValue(200n),
      readContract: vi.fn().mockResolvedValue(SAFE),
    } as unknown as PublicClient;
    const clientFor = (chainId: JBChainId) => (chainId === 1 ? ethereum : base);

    await expect(
      verifyQueuedProjectHandleTransaction({
        executionChainId: 1,
        safe: SAFE,
        transaction: setHandleTx(),
        clientFor,
      }),
    ).rejects.toThrow("no longer controlled by canonical REVOwner");
  });

  it("requires the exact ENS record before accepting a mainnet Handles call", async () => {
    const recordResponse = encodeFunctionResult({
      abi: ensTextResolverAbi,
      functionName: "text",
      result: "1:7",
    });
    const { client, request } = mainnetClient({
      request: vi.fn().mockResolvedValue(recordResponse),
    });
    await expect(
      verifyQueuedProjectHandleTransaction({
        executionChainId: 1,
        safe: SAFE,
        transaction: setHandleTx(1n, 7n, ["juicebox", "design"]),
        clientFor: () => client,
      }),
    ).resolves.toMatchObject({ kind: "project-handle" });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "eth_call",
        params: [expect.objectContaining({ from: JB_PROJECT_HANDLES_ADDRESS }), "0x64"],
      }),
    );

    request.mockResolvedValueOnce(
      encodeFunctionResult({
        abi: ensTextResolverAbi,
        functionName: "text",
        result: "1:8",
      }),
    );
    await expect(
      verifyQueuedProjectHandleTransaction({
        executionChainId: 1,
        safe: SAFE,
        transaction: setHandleTx(1n, 7n, ["juicebox", "design"]),
        clientFor: () => client,
      }),
    ).rejects.toThrow("exact ENS juicebox record no longer matches");
  });

  it("confirms the exact ENS resolver text after a mined setText execution", async () => {
    const transaction = setTextTx();
    const binding = classifyQueuedProjectHandleTransaction(1, transaction);
    expect(binding).toMatchObject({ kind: "ens-text" });
    if (!binding) throw new Error("Expected an ENS binding.");
    const request = vi.fn().mockResolvedValue(
      encodeFunctionResult({
        abi: ensTextResolverAbi,
        functionName: "text",
        result: "1:7",
      }),
    );
    const { client } = mainnetClient({ blockNumber: 99n, request });

    await expect(
      verifyQueuedProjectHandlePostcondition({
        binding,
        safe: SAFE,
        transaction,
        clientFor: () => client,
        executionBlockNumber: 100n,
      }),
    ).resolves.toBeUndefined();
    expect(client.getBlockNumber).not.toHaveBeenCalled();

    request.mockResolvedValue(
      encodeFunctionResult({
        abi: ensTextResolverAbi,
        functionName: "text",
        result: "1:8",
      }),
    );
    await expect(
      verifyQueuedProjectHandlePostcondition({
        binding,
        safe: SAFE,
        transaction,
        clientFor: () => client,
        executionBlockNumber: 100n,
      }),
    ).rejects.toThrow("does not match the reviewed value");

    const exactRequest = vi.fn().mockResolvedValue(
      encodeFunctionResult({
        abi: ensTextResolverAbi,
        functionName: "text",
        result: "1:7",
      }),
    );
    const { client: rotated } = mainnetClient({ operator: false, request: exactRequest });
    await expect(
      verifyQueuedProjectHandlePostcondition({
        binding,
        safe: SAFE,
        transaction,
        clientFor: () => rotated,
        executionBlockNumber: 100n,
      }),
    ).resolves.toBeUndefined();
  });

  it("confirms the exact reverse claim under live source and cross-chain authority", async () => {
    const transaction = setHandleTx();
    const binding = classifyQueuedProjectHandleTransaction(1, transaction);
    expect(binding).toMatchObject({ kind: "project-handle" });
    if (!binding) throw new Error("Expected a reverse-handle binding.");

    const clients = ({
      handle = "design.juicebox",
      latestMainnetBlock = 100n,
      mainnetCode,
      operator = true,
      record = "8453:42",
    }: {
      handle?: string;
      latestMainnetBlock?: bigint;
      mainnetCode?: Hex;
      operator?: boolean;
      record?: string;
    } = {}) => {
      const mainnetRequest = vi.fn(async ({ params }: { params: [{ to: Address }] }) => {
        const to = params[0].to.toLowerCase();
        return encodeFunctionResult({
          abi:
            to === JB_PROJECT_HANDLES_ADDRESS.toLowerCase()
              ? jbProjectHandlesAbi
              : ensTextResolverAbi,
          functionName: to === JB_PROJECT_HANDLES_ADDRESS.toLowerCase() ? "handleOf" : "text",
          result: to === JB_PROJECT_HANDLES_ADDRESS.toLowerCase() ? handle : record,
        } as never);
      });
      const mainnetGetBytecode = vi.fn().mockResolvedValue(mainnetCode);
      const mainnet = {
        getBlockNumber: vi.fn().mockResolvedValue(latestMainnetBlock),
        getBytecode: mainnetGetBytecode,
        readContract: vi.fn().mockResolvedValue(RESOLVER),
        request: mainnetRequest,
      } as unknown as PublicClient;
      const source = {
        getBlockNumber: vi.fn().mockResolvedValue(200n),
        getBytecode: vi.fn().mockResolvedValue(undefined),
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "ownerOf") {
            return getJBContractAddress(RevnetCoreContracts.REVOwner, 6, 8453);
          }
          if (functionName === "isOperatorOf") return operator;
          throw new Error(`Unexpected read ${functionName}`);
        }),
      } as unknown as PublicClient;
      return {
        mainnetGetBytecode,
        mainnetRequest,
        clientFor: (chainId: JBChainId) => (chainId === 1 ? mainnet : source),
      };
    };

    const lagging = clients({ latestMainnetBlock: 99n });
    await expect(
      verifyQueuedProjectHandlePostcondition({
        binding,
        safe: SAFE,
        transaction,
        clientFor: lagging.clientFor,
        executionBlockNumber: 100n,
      }),
    ).resolves.toBeUndefined();
    expect(lagging.mainnetGetBytecode).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: 100n }),
    );
    await expect(
      verifyQueuedProjectHandlePostcondition({
        binding,
        safe: SAFE,
        transaction,
        clientFor: clients({ handle: "other.juicebox" }).clientFor,
        executionBlockNumber: 100n,
      }),
    ).rejects.toThrow("exact reviewed handle");
    await expect(
      verifyQueuedProjectHandlePostcondition({
        binding,
        safe: SAFE,
        transaction,
        clientFor: clients({ mainnetCode: "0x6000" }).clientFor,
        executionBlockNumber: 100n,
      }),
    ).rejects.toThrow("cross-chain authority is no longer valid (mainnet-contract)");
    await expect(
      verifyQueuedProjectHandlePostcondition({
        binding,
        safe: SAFE,
        transaction,
        clientFor: clients({ operator: false }).clientFor,
        executionBlockNumber: 100n,
      }),
    ).rejects.toThrow("no longer the encoded revnet's live operator");
  });
});

describe("L2-only handle queue discovery", () => {
  it("adds one viewed-tuple-scoped mainnet queue and filters sibling bindings", () => {
    const targets = projectSafeQueueTargets([{ chainId: 8453, projectId: 42, safe: SAFE }], {
      chainId: 8453,
      projectId: 42,
    });
    expect(targets).toEqual([
      expect.objectContaining({ chainId: 8453, handleOnly: false }),
      expect.objectContaining({
        chainId: 1,
        safe: SAFE,
        handleOnly: true,
        handleSource: { chainId: 8453, projectId: 42 },
      }),
    ]);

    const viewed = classifyQueuedProjectHandleTransaction(1, setTextTx("8453:42"));
    const sibling = classifyQueuedProjectHandleTransaction(1, setHandleTx(8453n, 43n));
    expect(viewed && bindingMatchesProject(viewed, { chainId: 8453, projectId: 42 })).toBe(true);
    expect(sibling && bindingMatchesProject(sibling, { chainId: 8453, projectId: 42 })).toBe(false);
  });
});
