import {
  ensTextResolverAbi,
  JB_PROJECT_HANDLES_ADDRESS,
  jbProjectHandlesAbi,
} from "@/lib/projectHandles";
import {
  getJBContractAddress,
  JBCoreContracts,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { creationService, provenSafe, safeChain } from "./fixtures/safe-chain";

const OPERATOR = "0x1111111111111111111111111111111111111111";
const STALE_OPERATOR = "0x3333333333333333333333333333333333333333";
const RESOLVER = "0x2222222222222222222222222222222222222222";
const REV_OWNER = getJBContractAddress(RevnetCoreContracts.REVOwner, 6, 8453);
const DELEGATED_EOA_CODE = "0xef01002222222222222222222222222222222222222222";

const mocks = vi.hoisted(() => ({
  ensRecord: "8453:42",
  verifiedHandle: "design.juicebox",
  handleBySetter: {} as Record<string, string>,
  handleSetters: [] as string[],
  currentOperator: null as string | null,
  projectOwner: null as string | null,
  operatorCandidates: [] as string[],
  mainnetRead: vi.fn(),
  mainnetRequest: vi.fn(),
  mainnetBlockNumber: vi.fn(),
  mainnetCode: vi.fn(),
  mainnetStorage: vi.fn(),
  projectCode: vi.fn(),
  projectStorage: vi.fn(),
  projectRequest: vi.fn(),
  projectBlockNumber: vi.fn(),
  projectGetLogs: vi.fn(),
  projectRead: vi.fn(),
  getOperators: vi.fn(),
}));

vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: (chainId: number) =>
    chainId === 1
      ? {
          readContract: mocks.mainnetRead,
          request: mocks.mainnetRequest,
          getBlockNumber: mocks.mainnetBlockNumber,
          getCode: mocks.mainnetCode,
          getStorageAt: mocks.mainnetStorage,
        }
      : {
          readContract: mocks.projectRead,
          getCode: mocks.projectCode,
          getStorageAt: mocks.projectStorage,
          request: mocks.projectRequest,
          getBlockNumber: mocks.projectBlockNumber,
          getLogs: mocks.projectGetLogs,
        },
}));
vi.mock("@/app/[slug]/getProjectOperator", () => ({
  getIndexedProjectOperatorAddresses: mocks.getOperators,
}));
vi.mock("@/lib/ensPublicClient.server", () => ({
  getEnsPublicClient: () => ({
    readContract: mocks.mainnetRead,
    request: mocks.mainnetRequest,
    getBlockNumber: mocks.mainnetBlockNumber,
    getCode: mocks.mainnetCode,
    getStorageAt: mocks.mainnetStorage,
  }),
}));
vi.mock("@/app/[slug]/getSuckerGroup", () => ({ getSuckerGroup: async () => null }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(read: T) => read }));

import { readCanonicalHandle } from "@/app/[slug]/canonicalHandle.server";
import { resolveProjectRouteUncached } from "@/app/[slug]/resolveProjectRoute.server";

/** Ethereum's ENS resolver text and JBProjectHandles reverse claim, as raw eth_calls. */
async function ensAndHandles({ params }: { params: readonly unknown[] }) {
  const call = params[0] as { to: string; data: `0x${string}` };
  if (call.to.toLowerCase() === RESOLVER.toLowerCase()) {
    return encodeFunctionResult({
      abi: ensTextResolverAbi,
      functionName: "text",
      result: mocks.ensRecord,
    });
  }
  if (call.to.toLowerCase() === JB_PROJECT_HANDLES_ADDRESS.toLowerCase()) {
    const decoded = decodeFunctionData({ abi: jbProjectHandlesAbi, data: call.data });
    if (decoded.functionName !== "handleOf") throw new Error("Unexpected Handles call");
    const setter = decoded.args[2];
    mocks.handleSetters.push(setter);
    return encodeFunctionResult({
      abi: jbProjectHandlesAbi,
      functionName: "handleOf",
      result: mocks.handleBySetter[setter.toLowerCase()] ?? mocks.verifiedHandle,
    });
  }
  throw new Error(`Unexpected raw call: ${call.to}`);
}

describe("project handle routes", () => {
  beforeEach(() => {
    mocks.ensRecord = "8453:42";
    mocks.verifiedHandle = "design.juicebox";
    mocks.handleBySetter = {};
    mocks.handleSetters = [];
    mocks.currentOperator = OPERATOR;
    mocks.projectOwner = REV_OWNER;
    mocks.operatorCandidates = [OPERATOR];
    mocks.getOperators.mockImplementation(async () => mocks.operatorCandidates);
    mocks.mainnetRead.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "resolver") return RESOLVER;
      throw new Error(`Unexpected mainnet read: ${functionName}`);
    });
    mocks.mainnetRequest.mockImplementation(ensAndHandles);
    mocks.mainnetBlockNumber.mockResolvedValue(1_234n);
    mocks.mainnetCode.mockResolvedValue("0x");
    mocks.projectCode.mockResolvedValue("0x");
    mocks.projectBlockNumber.mockResolvedValue(47_398_760n);
    mocks.projectGetLogs.mockResolvedValue([]);
    mocks.projectRead.mockImplementation(
      async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
        if (functionName === "ownerOf") return mocks.projectOwner;
        if (functionName === "isOperatorOf") return args[1] === mocks.currentOperator;
        throw new Error(`Unexpected project read: ${functionName}`);
      },
    );
  });

  it("keeps numeric routes synchronous with no ENS dependency", async () => {
    await expect(resolveProjectRouteUncached("base:42")).resolves.toEqual({
      chainId: 8453,
      projectId: 42n,
    });
    await expect(resolveProjectRouteUncached("base%3A42")).resolves.toEqual({
      chainId: 8453,
      projectId: 42n,
    });
    expect(mocks.mainnetRead).not.toHaveBeenCalled();
  });

  it.each(["eth:42", "op:42", "arb:42", "sep:42", "basesep:42", "eth%3A42"])(
    "rejects a non-Base route %s before any upstream lookup",
    async (slug) => {
      await expect(resolveProjectRouteUncached(slug)).resolves.toBeNull();
      expect(mocks.mainnetRead).not.toHaveBeenCalled();
      expect(mocks.mainnetRequest).not.toHaveBeenCalled();
      expect(mocks.projectRead).not.toHaveBeenCalled();
      expect(mocks.projectBlockNumber).not.toHaveBeenCalled();
      expect(mocks.getOperators).not.toHaveBeenCalled();
    },
  );

  it.each(["1:42", "10:42", "42161:42", "84532:42"])(
    "rejects a handle pointing to %s before target-chain or operator lookups",
    async (record) => {
      mocks.ensRecord = record;
      await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();
      expect(mocks.mainnetRequest).toHaveBeenCalledTimes(1);
      expect(mocks.projectRead).not.toHaveBeenCalled();
      expect(mocks.projectBlockNumber).not.toHaveBeenCalled();
      expect(mocks.getOperators).not.toHaveBeenCalled();
      expect(mocks.handleSetters).toEqual([]);
    },
  );

  it("rejects a project id that the indexer would round to a different identity", async () => {
    await expect(resolveProjectRouteUncached("base:9007199254740993")).resolves.toBeNull();
    expect(mocks.mainnetRead).not.toHaveBeenCalled();
    expect(mocks.projectRead).not.toHaveBeenCalled();
    expect(mocks.getOperators).not.toHaveBeenCalled();
  });

  it("accepts only a forward and reverse verified current-operator handle", async () => {
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toEqual({
      chainId: 8453,
      projectId: 42n,
      verifiedOperator: OPERATOR,
      checkedAt: expect.any(Number),
    });
    expect(mocks.getOperators).toHaveBeenCalledWith(42, 8453);
    expect(mocks.mainnetRequest).toHaveBeenCalledWith({
      method: "eth_call",
      params: [
        expect.objectContaining({
          from: JB_PROJECT_HANDLES_ADDRESS,
          to: RESOLVER,
          gas: "0x1e848",
        }),
        "0x4d2",
      ],
    });
    expect(mocks.projectRead).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "isOperatorOf", args: [42n, OPERATOR] }),
    );
    expect(mocks.mainnetRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "eth_call",
        params: [
          expect.objectContaining({ to: JB_PROJECT_HANDLES_ADDRESS, gas: "0x493e0" }),
          "0x4d2",
        ],
      }),
    );
    await expect(resolveProjectRouteUncached("%40design.juicebox")).resolves.toEqual({
      chainId: 8453,
      projectId: 42n,
      verifiedOperator: OPERATOR,
      checkedAt: expect.any(Number),
    });
  });

  describe("with a Safe operator on Base", () => {
    // Creation records are cached per chain and Safe, so each case has a Safe of its own.
    let salt = 100n;
    function operatorSafe() {
      salt += 1n;
      const safe = provenSafe({ saltNonce: salt });
      const base = safeChain(safe.address);
      const ethereum = safeChain(safe.address, { otherRequest: ensAndHandles });
      mocks.currentOperator = safe.address;
      mocks.operatorCandidates = [safe.address];
      mocks.projectCode.mockImplementation(base.getCode);
      mocks.projectStorage.mockImplementation(base.getStorageAt);
      mocks.projectRequest.mockImplementation(base.request);
      mocks.mainnetCode.mockImplementation(ethereum.getCode);
      mocks.mainnetStorage.mockImplementation(ethereum.getStorageAt);
      mocks.mainnetRequest.mockImplementation(ethereum.request);
      return safe;
    }
    const creationRequests = (service: ReturnType<typeof vi.fn>) =>
      service.mock.calls.filter(([url]) => String(url).endsWith("/creation/")).length;

    it("routes when Base's Safe service proves the Safe is the same on Ethereum", async () => {
      const safe = operatorSafe();
      const service = creationService(safe, "base");
      vi.stubGlobal("fetch", service);

      await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toEqual({
        chainId: 8453,
        projectId: 42n,
        verifiedOperator: safe.address,
        checkedAt: expect.any(Number),
      });
      // A route render never waits on Safe's service without a bound.
      expect(service).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("reads a proven creation record once across route renders", async () => {
      const safe = operatorSafe();
      const service = creationService(safe, "base");
      vi.stubGlobal("fetch", service);

      for (let render = 0; render < 3; render += 1) {
        await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toMatchObject({
          verifiedOperator: safe.address,
          checkedAt: expect.any(Number),
        });
      }
      expect(creationRequests(service)).toBe(1);
    });

    it.each([
      ["is unreachable", vi.fn(async () => Promise.reject(new Error("offline")))],
      ["fails", vi.fn(async () => new Response("unavailable", { status: 503 }))],
      ["has no record", vi.fn(async () => new Response("Not found", { status: 404 }))],
    ])("leaves the route unproven when the Safe service %s", async (_case, service) => {
      operatorSafe();
      vi.stubGlobal("fetch", service);

      await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();
      expect(service).toHaveBeenCalled();
      // An unproven Safe never reaches the reverse claim.
      expect(mocks.handleSetters).toEqual([]);
    });

    it("gives an unproven operator Safe no canonical handle", async () => {
      operatorSafe();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("Not found", { status: 404 })),
      );

      await expect(readCanonicalHandle(8453, 42, null)).resolves.toBeNull();
    });

    it("makes a proven operator Safe's handle canonical", async () => {
      const safe = operatorSafe();
      vi.stubGlobal("fetch", creationService(safe, "base"));

      await expect(readCanonicalHandle(8453, 42, null)).resolves.toBe("design.juicebox");
    });

    it("refuses a 429 at once instead of waiting out its Retry-After", async () => {
      operatorSafe();
      const service = vi.fn(
        async () => new Response("slow down", { status: 429, headers: { "retry-after": "3600" } }),
      );
      vi.stubGlobal("fetch", service);

      await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();
      expect(creationRequests(service)).toBe(1);
    });

    it("gives up on a Safe service that never answers after 4 seconds", async () => {
      operatorSafe();
      vi.useFakeTimers();
      let asked!: () => void;
      const reached = new Promise<void>((resolve) => (asked = resolve));
      const service = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            asked();
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      );
      vi.stubGlobal("fetch", service);

      let settled = false;
      const route = resolveProjectRouteUncached("@design.juicebox");
      void route.then(() => (settled = true));
      await reached;
      await vi.advanceTimersByTimeAsync(3_999);
      expect(settled).toBe(false);
      // At 4 seconds the read is abandoned and the route settles without more waiting.
      await vi.advanceTimersByTimeAsync(1);
      for (let turn = 0; turn < 20 && !settled; turn += 1) await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      await expect(route).resolves.toBeNull();
      expect(creationRequests(service)).toBe(1);
    });
  });

  it("routes exact delegated EOAs but rejects contracts which only share the EIP-7702 prefix", async () => {
    mocks.projectCode.mockResolvedValue(DELEGATED_EOA_CODE);
    mocks.mainnetCode.mockResolvedValue("0x");
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toMatchObject({
      chainId: 8453,
      projectId: 42n,
      verifiedOperator: OPERATOR,
      checkedAt: expect.any(Number),
    });

    mocks.projectCode.mockResolvedValue(`${DELEGATED_EOA_CODE}00`);
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();
  });

  it("self-serves an arbitrary root .eth name from its text tuple and live publisher", async () => {
    mocks.verifiedHandle = "banny";

    await expect(resolveProjectRouteUncached("@banny")).resolves.toEqual({
      chainId: 8453,
      projectId: 42n,
      verifiedOperator: OPERATOR,
      checkedAt: expect.any(Number),
    });
    expect(mocks.handleSetters).toEqual([OPERATOR]);
    expect(mocks.getOperators).toHaveBeenCalledWith(42, 8453);
  });

  it("skips a stale indexed row and verifies the later live operator", async () => {
    mocks.operatorCandidates = [STALE_OPERATOR, OPERATOR];

    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toEqual({
      chainId: 8453,
      projectId: 42n,
      verifiedOperator: OPERATOR,
      checkedAt: expect.any(Number),
    });
    expect(
      mocks.projectRead.mock.calls
        .filter(([call]) => call.functionName === "isOperatorOf")
        .map(([call]) => call.args[1]),
    ).toEqual([STALE_OPERATOR, OPERATOR]);
    expect(mocks.handleSetters).toEqual([OPERATOR]);
  });

  it("discovers the live publisher from canonical permission history during indexer lag", async () => {
    mocks.getOperators.mockRejectedValue(new Error("Indexer unavailable"));
    mocks.projectBlockNumber.mockResolvedValue(47_398_761n);
    mocks.projectGetLogs.mockResolvedValue([
      {
        args: {
          operator: STALE_OPERATOR,
          account: REV_OWNER,
          projectId: 42n,
          permissionIds: [],
          packed: 0n,
          caller: REV_OWNER,
        },
        blockNumber: 47_398_760n,
        logIndex: 1,
      },
      {
        args: {
          operator: OPERATOR,
          account: REV_OWNER,
          projectId: 42n,
          permissionIds: [7],
          packed: 1n,
          caller: REV_OWNER,
        },
        blockNumber: 47_398_759n,
        logIndex: 0,
      },
    ]);

    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toEqual({
      chainId: 8453,
      projectId: 42n,
      verifiedOperator: OPERATOR,
      checkedAt: expect.any(Number),
    });
    expect(mocks.projectGetLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: getJBContractAddress(JBCoreContracts.JBPermissions, 6, 8453),
        args: { account: REV_OWNER, projectId: 42n },
        fromBlock: 47_398_751n,
        toBlock: 47_398_761n,
      }),
    );
    expect(
      mocks.projectRead.mock.calls
        .filter(([call]) => call.functionName === "isOperatorOf")
        .map(([call]) => call.args[1]),
    ).toEqual([OPERATOR]);
  });

  it("rejects a mismatched live indexed operator without scanning history", async () => {
    mocks.operatorCandidates = [STALE_OPERATOR];
    mocks.projectBlockNumber.mockResolvedValue(47_398_761n);
    mocks.projectRead.mockImplementation(
      async ({ functionName }: { functionName: string; args: readonly unknown[] }) => {
        if (functionName === "ownerOf") return REV_OWNER;
        if (functionName === "isOperatorOf") return true;
        throw new Error(`Unexpected project read: ${functionName}`);
      },
    );
    mocks.handleBySetter[OPERATOR.toLowerCase()] = "design.juicebox";
    mocks.handleBySetter[STALE_OPERATOR.toLowerCase()] = "old.juicebox";
    mocks.projectGetLogs.mockResolvedValue([
      {
        args: { operator: OPERATOR, packed: 1n },
        blockNumber: 47_398_759n,
        logIndex: 0,
      },
    ]);

    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();
    expect(mocks.projectGetLogs).not.toHaveBeenCalled();
    expect(mocks.handleSetters).toEqual([STALE_OPERATOR]);
  });

  it("fails closed for stale operators, reverse mismatches, and malformed records", async () => {
    mocks.projectOwner = OPERATOR;
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();

    mocks.projectOwner = REV_OWNER;
    mocks.projectCode.mockResolvedValue("0x60006000");
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();
    mocks.projectCode.mockResolvedValue("0x");

    mocks.currentOperator = null;
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();

    mocks.currentOperator = OPERATOR;
    mocks.verifiedHandle = "someone-else.juicebox";
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();

    // The contract's return must already be canonical. Normalizing an unsafe
    // raw value here would accept a different reverse claim than handleOf made.
    mocks.verifiedHandle = "DESIGN.JUICEBOX";
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();

    mocks.verifiedHandle = "design.juicebox";
    mocks.ensRecord = "8453:42 ";
    await expect(resolveProjectRouteUncached("@design.juicebox")).resolves.toBeNull();

    mocks.ensRecord = "8453:42";
    mocks.mainnetRead.mockClear();
    mocks.mainnetRequest.mockClear();
    await expect(resolveProjectRouteUncached("%E0%A4%A")).resolves.toBeNull();
    await expect(resolveProjectRouteUncached("%2540design.juicebox")).resolves.toBeNull();
    expect(mocks.mainnetRead).not.toHaveBeenCalled();
  });
});

describe("canonical project handle", () => {
  beforeEach(() => {
    mocks.ensRecord = "8453:42";
    mocks.verifiedHandle = "design.juicebox";
    mocks.handleBySetter = {};
    mocks.handleSetters = [];
    mocks.currentOperator = OPERATOR;
    mocks.projectOwner = REV_OWNER;
    mocks.operatorCandidates = [OPERATOR];
    mocks.getOperators.mockImplementation(async () => mocks.operatorCandidates);
    mocks.mainnetRead.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "resolver") return RESOLVER;
      throw new Error(`Unexpected mainnet read: ${functionName}`);
    });
    mocks.mainnetRequest.mockImplementation(ensAndHandles);
    mocks.mainnetBlockNumber.mockResolvedValue(1_234n);
    mocks.mainnetCode.mockResolvedValue("0x");
    mocks.projectCode.mockResolvedValue("0x");
    mocks.projectBlockNumber.mockResolvedValue(47_398_760n);
    mocks.projectGetLogs.mockResolvedValue([]);
    mocks.projectRead.mockImplementation(
      async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
        if (functionName === "ownerOf") return mocks.projectOwner;
        if (functionName === "isOperatorOf") return args[1] === mocks.currentOperator;
        throw new Error(`Unexpected project read: ${functionName}`);
      },
    );
  });

  it("is a handle whose own route verifies it for this project", async () => {
    await expect(readCanonicalHandle(8453, 42, null)).resolves.toBe("design.juicebox");
  });

  it("is never a handle whose ENS record names another project", async () => {
    mocks.ensRecord = "8453:43";

    await expect(readCanonicalHandle(8453, 42, null)).resolves.toBeNull();
  });

  it("is never a handle its setter no longer operates", async () => {
    mocks.currentOperator = STALE_OPERATOR;
    mocks.operatorCandidates = [OPERATOR];

    await expect(readCanonicalHandle(8453, 42, null)).resolves.toBeNull();
  });
});
