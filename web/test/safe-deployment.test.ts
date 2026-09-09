import {
  RECOGNIZED_SAFE_RELEASES,
  SAFE_CANONICAL_PAYMENT_RECEIVER,
  SAFE_L1_L2_SINGLETON_PAIRS,
  SAFE_TO_L2_SETUP_ADDRESS,
  safeSingletonsAreEquivalent,
  type SafeAuthorityIdentity,
} from "@/lib/cross-chain-authority";
import {
  buildSafeProxyFactoryCall,
  fetchSafeCreation,
  parseSafeCreationPayload,
  safeCreationUrl,
  safeProxyFactoryAbi,
  safeSetupAbi,
  safeToL2SetupAbi,
  simulateSafeProxyDeployment,
  simulatedSafeAddressMatchesExpected,
  validateSafeCreationForCurrentPolicy,
  verifySafeDeploymentAfterReceipt,
  type SafeCreation,
} from "@/lib/safeDeployment";
import {
  decodeFunctionData,
  encodeFunctionData,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";

const SAFE = "0x1111111111111111111111111111111111111111" as Address;
const OWNER_A = "0x2222222222222222222222222222222222222222" as Address;
const OWNER_B = "0x3333333333333333333333333333333333333333" as Address;
const FALLBACK = "0x4444444444444444444444444444444444444444" as Address;
const OTHER = "0x5555555555555555555555555555555555555555" as Address;
const SINGLETON = RECOGNIZED_SAFE_RELEASES[0].singletons[0];
const FACTORY = RECOGNIZED_SAFE_RELEASES[0].factories[0];
const PROXY_RUNTIME =
  "0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea2646970667358221220d1429297349653a4918076d650332de1a1068c5f3e07c5c82360c277770b955264736f6c63430007060033" as Hex;
const SINGLETON_CODE = "0x60006000" as Hex;
const FALLBACK_CODE = "0x60016000" as Hex;
const FACTORY_CODE = "0x60026000" as Hex;
const DELEGATED_EOA_CODE = `0xef0100${OTHER.slice(2)}` as Hex;
const PREFIXED_CONTRACT_CODE = `${DELEGATED_EOA_CODE}00` as Hex;

function initializer({
  owners = [OWNER_A, OWNER_B],
  threshold = 2n,
  to = zeroAddress,
  data = "0x" as Hex,
  fallbackHandler = FALLBACK,
  paymentToken = zeroAddress,
  payment = 0n,
  paymentReceiver = zeroAddress,
}: {
  owners?: Address[];
  threshold?: bigint;
  to?: Address;
  data?: Hex;
  fallbackHandler?: Address;
  paymentToken?: Address;
  payment?: bigint;
  paymentReceiver?: Address;
} = {}): Hex {
  return encodeFunctionData({
    abi: safeSetupAbi,
    functionName: "setup",
    args: [owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver],
  });
}

function creation(overrides: Partial<SafeCreation> = {}): SafeCreation {
  return {
    factory: FACTORY,
    singleton: SINGLETON,
    initializer: initializer(),
    saltNonce: 42n,
    ...overrides,
  };
}

function currentSafe(overrides: Partial<SafeAuthorityIdentity> = {}): SafeAuthorityIdentity {
  return {
    kind: "safe",
    proxyCodeHash: keccak256(PROXY_RUNTIME),
    singleton: SINGLETON,
    singletonCodeHash: keccak256(SINGLETON_CODE),
    version: "1.3.0",
    owners: [OWNER_A, OWNER_B],
    threshold: 2,
    fallbackHandler: FALLBACK,
    fallbackHandlerCodeHash: keccak256(FALLBACK_CODE),
    guard: zeroAddress,
    hasModules: false,
    ownersAreEoas: true,
    ...overrides,
  };
}

describe("Safe creation discovery", () => {
  it("builds a source-chain-only creation URL", () => {
    expect(safeCreationUrl(8453, SAFE)).toBe(
      `https://api.safe.global/tx-service/base/api/v1/safes/${SAFE}/creation/`,
    );
    expect(safeCreationUrl(84532, SAFE)).toBeNull();
    expect(safeCreationUrl(1, "not-an-address")).toBeNull();
  });

  it("strictly parses recognized factory/singleton creation data", () => {
    expect(
      parseSafeCreationPayload({
        factoryAddress: FACTORY,
        masterCopy: SINGLETON,
        setupData: initializer(),
        saltNonce: "42",
      }),
    ).toEqual(creation());

    expect(
      parseSafeCreationPayload({
        factoryAddress: OTHER,
        masterCopy: SINGLETON,
        setupData: initializer(),
        saltNonce: "42",
      }),
    ).toBeNull();
    expect(
      parseSafeCreationPayload({
        factoryAddress: FACTORY,
        masterCopy: SINGLETON,
        setupData: "0x123",
        saltNonce: "42",
      }),
    ).toBeNull();
    expect(
      parseSafeCreationPayload({
        factoryAddress: FACTORY,
        masterCopy: SINGLETON,
        setupData: initializer(),
      }),
    ).toBeNull();
  });

  it("fetches only the requested source service and fails closed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          factoryAddress: FACTORY,
          masterCopy: SINGLETON,
          setupData: initializer(),
          saltNonce: "42",
        }),
        { status: 200 },
      ),
    );
    const fetcher = fetchMock as unknown as typeof fetch;
    await expect(fetchSafeCreation(SAFE, 8453, fetcher)).resolves.toEqual(creation());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/tx-service/base/");

    await expect(fetchSafeCreation(SAFE, 84532, fetcher)).resolves.toBeNull();
    await expect(
      fetchSafeCreation(
        SAFE,
        8453,
        vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
  });
});

describe("Safe creation policy validation", () => {
  it("accepts only an initializer for the exact current live policy", () => {
    expect(validateSafeCreationForCurrentPolicy(creation(), currentSafe())).toMatchObject({
      valid: true,
      owners: [OWNER_A, OWNER_B],
      threshold: 2,
      fallbackHandler: FALLBACK,
    });
    expect(
      validateSafeCreationForCurrentPolicy(
        creation({ initializer: initializer({ owners: [OWNER_A], threshold: 1n }) }),
        currentSafe(),
      ),
    ).toEqual({ valid: false, reason: "initializer-policy-mismatch" });
    expect(
      validateSafeCreationForCurrentPolicy(
        creation({ initializer: initializer({ fallbackHandler: OTHER }) }),
        currentSafe(),
      ),
    ).toEqual({ valid: false, reason: "initializer-policy-mismatch" });
  });

  it("rejects setup hooks, payments, guards, modules, and contract owners", () => {
    expect(
      validateSafeCreationForCurrentPolicy(
        creation({ initializer: initializer({ to: OTHER, data: "0x1234" }) }),
        currentSafe(),
      ),
    ).toEqual({ valid: false, reason: "unsafe-initializer" });
    expect(
      validateSafeCreationForCurrentPolicy(
        creation({ initializer: initializer({ paymentToken: OTHER, payment: 1n }) }),
        currentSafe(),
      ),
    ).toEqual({ valid: false, reason: "unsafe-initializer" });

    for (const policy of [
      currentSafe({ guard: OTHER }),
      currentSafe({ hasModules: true }),
      currentSafe({ ownersAreEoas: false }),
    ]) {
      expect(validateSafeCreationForCurrentPolicy(creation(), policy)).toEqual({
        valid: false,
        reason: "unsafe-current-policy",
      });
    }
  });

  it("rejects malformed and noncanonical initializer bytes", () => {
    expect(
      validateSafeCreationForCurrentPolicy(creation({ initializer: "0x1234" }), currentSafe()),
    ).toEqual({ valid: false, reason: "malformed-initializer" });
    expect(
      validateSafeCreationForCurrentPolicy(
        creation({ initializer: `${initializer()}00` }),
        currentSafe(),
      ),
    ).toEqual({ valid: false, reason: "malformed-initializer" });
  });
});

describe("same-address Safe deployment calls", () => {
  it("builds the exact createProxyWithNonce calldata", () => {
    const call = buildSafeProxyFactoryCall(creation());
    expect(call.target).toBe(FACTORY);
    expect(decodeFunctionData({ abi: safeProxyFactoryAbi, data: call.data })).toEqual({
      functionName: "createProxyWithNonce",
      args: [SINGLETON, initializer(), 42n],
    });
  });

  it("simulates the factory and requires the exact expected proxy address", async () => {
    const client = {
      getBytecode: vi.fn(async ({ address }: { address: Address }) => {
        if (address === FACTORY) return FACTORY_CODE;
        if (address === SINGLETON) return SINGLETON_CODE;
        if (address === FALLBACK) return FALLBACK_CODE;
        return undefined;
      }),
      simulateContract: vi.fn().mockResolvedValue({ result: SAFE }),
    } as unknown as PublicClient;

    await expect(
      simulateSafeProxyDeployment({
        client,
        creation: creation(),
        expectedSafe: SAFE,
        currentSafe: currentSafe(),
      }),
    ).resolves.toMatchObject({ valid: true });
    expect(simulatedSafeAddressMatchesExpected(SAFE, SAFE)).toBe(true);
    expect(simulatedSafeAddressMatchesExpected(OTHER, SAFE)).toBe(false);
  });

  it("accepts only exact EIP-7702 Safe owners at the destination", async () => {
    const clientWithOwnerCode = (ownerCode: Hex) =>
      ({
        getBytecode: vi.fn(async ({ address }: { address: Address }) => {
          if (address === FACTORY) return FACTORY_CODE;
          if (address === SINGLETON) return SINGLETON_CODE;
          if (address === FALLBACK) return FALLBACK_CODE;
          if (address === OWNER_A) return ownerCode;
          return undefined;
        }),
        simulateContract: vi.fn().mockResolvedValue({ result: SAFE }),
      }) as unknown as PublicClient;

    await expect(
      simulateSafeProxyDeployment({
        client: clientWithOwnerCode(DELEGATED_EOA_CODE),
        creation: creation(),
        expectedSafe: SAFE,
        currentSafe: currentSafe(),
      }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      simulateSafeProxyDeployment({
        client: clientWithOwnerCode(PREFIXED_CONTRACT_CODE),
        creation: creation(),
        expectedSafe: SAFE,
        currentSafe: currentSafe(),
      }),
    ).resolves.toEqual({ valid: false, reason: "contract-owner" });
  });

  it("rejects an exact EIP-7702 destination fallback handler even when its hash matches", async () => {
    const client = {
      getBytecode: vi.fn(async ({ address }: { address: Address }) => {
        if (address === FACTORY) return FACTORY_CODE;
        if (address === SINGLETON) return SINGLETON_CODE;
        if (address === FALLBACK) return DELEGATED_EOA_CODE;
        return undefined;
      }),
      simulateContract: vi.fn().mockResolvedValue({ result: SAFE }),
    } as unknown as PublicClient;

    await expect(
      simulateSafeProxyDeployment({
        client,
        creation: creation(),
        expectedSafe: SAFE,
        currentSafe: currentSafe({
          fallbackHandlerCodeHash: keccak256(DELEGATED_EOA_CODE),
        }),
      }),
    ).resolves.toEqual({ valid: false, reason: "delegated-fallback-handler" });
    expect(client.simulateContract).not.toHaveBeenCalled();
  });

  it("rejects occupied addresses and destination implementation drift", async () => {
    const occupied = {
      getBytecode: vi.fn().mockResolvedValue(PROXY_RUNTIME),
      simulateContract: vi.fn(),
    } as unknown as PublicClient;
    await expect(
      simulateSafeProxyDeployment({
        client: occupied,
        creation: creation(),
        expectedSafe: SAFE,
        currentSafe: currentSafe(),
      }),
    ).resolves.toEqual({ valid: false, reason: "address-occupied" });

    const delegatedDestination = {
      getBytecode: vi.fn().mockResolvedValue(DELEGATED_EOA_CODE),
      simulateContract: vi.fn(),
    } as unknown as PublicClient;
    await expect(
      simulateSafeProxyDeployment({
        client: delegatedDestination,
        creation: creation(),
        expectedSafe: SAFE,
        currentSafe: currentSafe(),
      }),
    ).resolves.toEqual({ valid: false, reason: "address-occupied" });

    const malformedRpc = {
      getBytecode: vi.fn().mockResolvedValue("not-hex"),
      simulateContract: vi.fn(),
    } as unknown as PublicClient;
    await expect(
      simulateSafeProxyDeployment({
        client: malformedRpc,
        creation: creation(),
        expectedSafe: SAFE,
        currentSafe: currentSafe(),
      }),
    ).resolves.toEqual({ valid: false, reason: "rpc-error" });

    const drifted = {
      getBytecode: vi.fn(async ({ address }: { address: Address }) => {
        if (address === FACTORY) return FACTORY_CODE;
        if (address === SINGLETON) return "0x6009";
        if (address === FALLBACK) return FALLBACK_CODE;
        return undefined;
      }),
      simulateContract: vi.fn(),
    } as unknown as PublicClient;
    await expect(
      simulateSafeProxyDeployment({
        client: drifted,
        creation: creation(),
        expectedSafe: SAFE,
        currentSafe: currentSafe(),
      }),
    ).resolves.toEqual({ valid: false, reason: "singleton-mismatch" });
  });

  it("exposes a mandatory post-receipt full parity check", async () => {
    const eoaClient = {
      getBytecode: vi.fn().mockResolvedValue(undefined),
    } as unknown as PublicClient;
    await expect(
      verifySafeDeploymentAfterReceipt({
        sourceChainId: 8453,
        sourceClient: eoaClient,
        mainnetClient: eoaClient,
        authority: SAFE,
      }),
    ).resolves.toMatchObject({ status: "valid-eoa", allowed: true });
  });
});

describe("canonical SafeToL2Setup creation", () => {
  const L1_SINGLETON = SAFE_L1_L2_SINGLETON_PAIRS[0][0];
  const L2_SINGLETON = SAFE_L1_L2_SINGLETON_PAIRS[0][1];
  const L2_FACTORY = RECOGNIZED_SAFE_RELEASES[1].factories[0];

  function l2SetupData(l2Singleton: Address = L2_SINGLETON): Hex {
    return encodeFunctionData({
      abi: safeToL2SetupAbi,
      functionName: "setupToL2",
      args: [l2Singleton],
    });
  }

  function l2Creation(overrides: Partial<SafeCreation> = {}): SafeCreation {
    return creation({
      factory: L2_FACTORY,
      singleton: L1_SINGLETON,
      initializer: initializer({
        to: SAFE_TO_L2_SETUP_ADDRESS,
        data: l2SetupData(),
        paymentReceiver: SAFE_CANONICAL_PAYMENT_RECEIVER,
      }),
      ...overrides,
    });
  }

  // The source Safe lives on an L2, where SafeToL2Setup already repointed
  // slot zero at SafeL2 while the creation record still names the Ethereum
  // singleton.
  const l2Safe = currentSafe({ singleton: L2_SINGLETON, version: "1.4.1" });

  it("accepts the initializer the Safe interface deploys on an L2", () => {
    expect(validateSafeCreationForCurrentPolicy(l2Creation(), l2Safe)).toMatchObject({
      valid: true,
    });
  });

  it("treats an Ethereum/SafeL2 pair as one release", () => {
    expect(safeSingletonsAreEquivalent(L1_SINGLETON, L2_SINGLETON)).toBe(true);
    expect(safeSingletonsAreEquivalent(L2_SINGLETON, L1_SINGLETON)).toBe(true);
    expect(safeSingletonsAreEquivalent(L1_SINGLETON, L1_SINGLETON)).toBe(true);
    expect(safeSingletonsAreEquivalent(L1_SINGLETON, SINGLETON)).toBe(false);
  });

  it("rejects a foreign delegatecall target", () => {
    expect(
      validateSafeCreationForCurrentPolicy(
        l2Creation({ initializer: initializer({ to: OTHER, data: l2SetupData() }) }),
        l2Safe,
      ),
    ).toEqual({ valid: false, reason: "unsafe-initializer" });
  });

  it("rejects tampered SafeToL2Setup calldata", () => {
    for (const data of [
      l2SetupData(OTHER),
      "0x" as Hex,
      `${l2SetupData()}00` as Hex,
      `0xdeadbeef${l2SetupData().slice(10)}` as Hex,
    ]) {
      expect(
        validateSafeCreationForCurrentPolicy(
          l2Creation({
            initializer: initializer({ to: SAFE_TO_L2_SETUP_ADDRESS, data }),
          }),
          l2Safe,
        ),
      ).toEqual({ valid: false, reason: "unsafe-initializer" });
    }
  });

  it("still rejects a non-zero setup payment", () => {
    expect(
      validateSafeCreationForCurrentPolicy(
        l2Creation({
          initializer: initializer({
            to: SAFE_TO_L2_SETUP_ADDRESS,
            data: l2SetupData(),
            payment: 1n,
            paymentReceiver: SAFE_CANONICAL_PAYMENT_RECEIVER,
          }),
        }),
        l2Safe,
      ),
    ).toEqual({ valid: false, reason: "unsafe-initializer" });

    expect(
      validateSafeCreationForCurrentPolicy(
        l2Creation({
          initializer: initializer({
            to: SAFE_TO_L2_SETUP_ADDRESS,
            data: l2SetupData(),
            paymentReceiver: OTHER,
          }),
        }),
        l2Safe,
      ),
    ).toEqual({ valid: false, reason: "unsafe-initializer" });
  });

  it("still rejects a singleton outside the creation's own release", () => {
    expect(
      validateSafeCreationForCurrentPolicy(
        l2Creation(),
        currentSafe({ singleton: SINGLETON, version: "1.3.0" }),
      ),
    ).toEqual({ valid: false, reason: "initializer-policy-mismatch" });
  });
});
