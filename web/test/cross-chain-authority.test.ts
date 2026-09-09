import {
  RECOGNIZED_SAFE_RELEASES,
  SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
  SAFE_GUARD_STORAGE_SLOT,
  SAFE_L1_L2_SINGLETON_PAIRS,
  SAFE_MODULES_SENTINEL,
  authorityIdentitiesMatch,
  readAuthorityIdentity,
  readBoundedSafeNonce,
  readCrossChainHandleAuthority,
  type SafeAuthorityIdentity,
} from "@/lib/cross-chain-authority";
import {
  encodeAbiParameters,
  keccak256,
  padHex,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";

const AUTHORITY = "0x1111111111111111111111111111111111111111" as Address;
const OWNER_A = "0x2222222222222222222222222222222222222222" as Address;
const OWNER_B = "0x3333333333333333333333333333333333333333" as Address;
const FALLBACK = "0x4444444444444444444444444444444444444444" as Address;
const OTHER_FALLBACK = "0x5555555555555555555555555555555555555555" as Address;
const MODULE = "0x6666666666666666666666666666666666666666" as Address;
const SINGLETON = RECOGNIZED_SAFE_RELEASES[0].singletons[0];
const OTHER_SINGLETON = RECOGNIZED_SAFE_RELEASES[1].singletons[0];
const PROXY_CODE =
  "0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea2646970667358221220d1429297349653a4918076d650332de1a1068c5f3e07c5c82360c277770b955264736f6c63430007060033" as Hex;
const CONTRACT_CODE = "0x60006000" as Hex;
const FALLBACK_CODE = "0x60016000" as Hex;
const DELEGATED_EOA_CODE = `0xef0100${FALLBACK.slice(2)}` as Hex;
const OTHER_DELEGATED_EOA_CODE = `0xef0100${OTHER_FALLBACK.slice(2)}` as Hex;
const PREFIXED_CONTRACT_CODE = `${DELEGATED_EOA_CODE}00` as Hex;

function storageWord(address: Address): Hex {
  return padHex(address, { size: 32 });
}

function safeIdentity(overrides: Partial<SafeAuthorityIdentity> = {}): SafeAuthorityIdentity {
  return {
    kind: "safe",
    proxyCodeHash: keccak256(PROXY_CODE),
    singleton: SINGLETON,
    singletonCodeHash: keccak256(CONTRACT_CODE),
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

function mockedSafeClient({
  singleton = SINGLETON,
  version = "1.3.0",
  owners = [OWNER_A, OWNER_B],
  threshold = 2n,
  fallbackHandler = FALLBACK,
  fallbackHandlerCode = FALLBACK_CODE,
  guard = zeroAddress,
  modules = [] as Address[],
  contractOwners = [] as Address[],
  delegatedOwners = [] as Address[],
  prefixedContractOwners = [] as Address[],
}: {
  singleton?: Address;
  version?: string;
  owners?: Address[];
  threshold?: bigint;
  fallbackHandler?: Address;
  fallbackHandlerCode?: Hex;
  guard?: Address;
  modules?: Address[];
  contractOwners?: Address[];
  delegatedOwners?: Address[];
  prefixedContractOwners?: Address[];
} = {}): PublicClient {
  const getBytecode = vi.fn(async ({ address }: { address: Address }) => {
    if (address.toLowerCase() === AUTHORITY.toLowerCase()) return PROXY_CODE;
    if (address.toLowerCase() === singleton.toLowerCase()) return CONTRACT_CODE;
    if (
      address.toLowerCase() === fallbackHandler.toLowerCase() &&
      fallbackHandler.toLowerCase() !== zeroAddress.toLowerCase()
    ) {
      return fallbackHandlerCode;
    }
    if (contractOwners.some((owner) => owner.toLowerCase() === address.toLowerCase())) {
      return CONTRACT_CODE;
    }
    if (delegatedOwners.some((owner) => owner.toLowerCase() === address.toLowerCase())) {
      return DELEGATED_EOA_CODE;
    }
    if (prefixedContractOwners.some((owner) => owner.toLowerCase() === address.toLowerCase())) {
      return PREFIXED_CONTRACT_CODE;
    }
    return undefined;
  });
  const getStorageAt = vi.fn(async ({ slot }: { slot: Hex }) => {
    if (slot === SAFE_FALLBACK_HANDLER_STORAGE_SLOT) return storageWord(fallbackHandler);
    if (slot === SAFE_GUARD_STORAGE_SLOT) return storageWord(guard);
    return storageWord(singleton);
  });
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    throw new Error(`Unexpected generic read ${functionName}`);
  });
  const request = vi.fn(async ({ params }: { params: [{ data: Hex }] }) => {
    const selector = params[0].data.slice(0, 10);
    if (selector === toFunctionSelector("masterCopy()")) {
      return encodeAbiParameters([{ type: "address" }], [singleton]);
    }
    if (selector === toFunctionSelector("VERSION()")) {
      return encodeAbiParameters([{ type: "string" }], [version]);
    }
    if (selector === toFunctionSelector("getThreshold()")) {
      return encodeAbiParameters([{ type: "uint256" }], [threshold]);
    }
    if (selector === toFunctionSelector("getOwners()")) {
      return encodeAbiParameters([{ type: "address[]" }], [owners]);
    }
    if (selector === toFunctionSelector("getModulesPaginated(address,uint256)")) {
      return encodeAbiParameters(
        [{ type: "address[]" }, { type: "address" }],
        [modules, SAFE_MODULES_SENTINEL],
      );
    }
    if (selector === toFunctionSelector("nonce()")) {
      return encodeAbiParameters([{ type: "uint256" }], [7n]);
    }
    throw new Error(`Unexpected raw call ${selector}`);
  });
  return { getBytecode, getStorageAt, readContract, request } as unknown as PublicClient;
}

function replaceOwnersResponse(client: PublicClient, response: Hex) {
  const request = client.request as unknown as ReturnType<typeof vi.fn>;
  const original = request.getMockImplementation() as (args: {
    params: [{ data: Hex }];
  }) => unknown;
  request.mockImplementation(async (args: { params: [{ data: Hex }] }) => {
    const data = (args.params[0] as { data: Hex }).data;
    return data.startsWith(toFunctionSelector("getOwners()"))
      ? (response as never)
      : original(args);
  });
}

function eoaClient(
  contractAddresses: readonly Address[] = [],
  code: Hex | undefined = undefined,
): PublicClient {
  return {
    getBytecode: vi.fn(async ({ address }: { address: Address }) =>
      contractAddresses.some((candidate) => candidate.toLowerCase() === address.toLowerCase())
        ? (code ?? CONTRACT_CODE)
        : code,
    ),
  } as unknown as PublicClient;
}

describe("cross-chain authority policy", () => {
  it("matches only EOAs or exact hardened Safe policies", () => {
    expect(authorityIdentitiesMatch({ kind: "eoa" }, { kind: "eoa", delegation: FALLBACK })).toBe(
      true,
    );
    expect(
      authorityIdentitiesMatch(
        { kind: "eoa", delegation: FALLBACK },
        { kind: "eoa", delegation: OTHER_FALLBACK },
      ),
    ).toBe(true);
    expect(authorityIdentitiesMatch({ kind: "eoa" }, { kind: "contract" })).toBe(false);
    expect(
      authorityIdentitiesMatch(safeIdentity(), safeIdentity({ owners: [OWNER_B, OWNER_A] })),
    ).toBe(true);

    expect(authorityIdentitiesMatch(safeIdentity(), safeIdentity({ threshold: 1 }))).toBe(false);
    expect(
      authorityIdentitiesMatch(
        safeIdentity(),
        safeIdentity({ singleton: OTHER_SINGLETON, version: "1.4.1" }),
      ),
    ).toBe(false);
    expect(
      authorityIdentitiesMatch(safeIdentity(), safeIdentity({ fallbackHandler: OTHER_FALLBACK })),
    ).toBe(false);
    expect(authorityIdentitiesMatch(safeIdentity(), safeIdentity({ guard: MODULE }))).toBe(false);
    expect(authorityIdentitiesMatch(safeIdentity(), safeIdentity({ hasModules: true }))).toBe(
      false,
    );
    expect(authorityIdentitiesMatch(safeIdentity(), safeIdentity({ ownersAreEoas: false }))).toBe(
      false,
    );
  });

  it("recognizes a canonical proxy from live storage, version, and policy reads", async () => {
    const client = mockedSafeClient();
    await expect(readAuthorityIdentity(client, AUTHORITY)).resolves.toEqual(safeIdentity());
    expect(client.request).toHaveBeenCalledWith({
      method: "eth_call",
      params: [expect.objectContaining({ to: AUTHORITY, gas: "0x7a120" }), "latest"],
    });
    expect(client.readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getOwners" }),
    );
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("accepts exact delegated owners but rejects an exact delegated fallback handler", async () => {
    await expect(
      readAuthorityIdentity(mockedSafeClient({ delegatedOwners: [OWNER_A] }), AUTHORITY),
    ).resolves.toMatchObject({ kind: "safe", ownersAreEoas: true });

    const delegatedFallback = mockedSafeClient({ fallbackHandlerCode: DELEGATED_EOA_CODE });
    await expect(readAuthorityIdentity(delegatedFallback, AUTHORITY)).resolves.toEqual({
      kind: "contract",
    });
    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: delegatedFallback,
        mainnetClient: mockedSafeClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "source-contract", allowed: false });
  });

  it("rejects oversized or malformed owner returndata before ABI decoding", async () => {
    const oversized = mockedSafeClient();
    replaceOwnersResponse(
      oversized,
      encodeAbiParameters(
        [{ type: "address[]" }],
        [
          Array.from(
            { length: 51 },
            (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}` as Address,
          ),
        ],
      ),
    );
    await expect(readAuthorityIdentity(oversized, AUTHORITY)).resolves.toEqual({
      kind: "contract",
    });

    const malformed = mockedSafeClient();
    replaceOwnersResponse(malformed, "0x1234");
    await expect(readAuthorityIdentity(malformed, AUTHORITY)).resolves.toEqual({
      kind: "contract",
    });
  });

  it("reads Safe nonce through a raw fixed-width call", async () => {
    const client = mockedSafeClient();
    await expect(readBoundedSafeNonce(client, AUTHORITY)).resolves.toBe(7n);
    expect(client.request).toHaveBeenCalledWith({
      method: "eth_call",
      params: [expect.objectContaining({ to: AUTHORITY, gas: "0x249f0" }), "latest"],
    });
  });

  it("does not recognize ABI-shaped arbitrary contracts or malformed Safes", async () => {
    const arbitrary = {
      getBytecode: vi.fn().mockResolvedValue(CONTRACT_CODE),
    } as unknown as PublicClient;
    await expect(readAuthorityIdentity(arbitrary, AUTHORITY)).resolves.toEqual({
      kind: "contract",
    });

    await expect(
      readAuthorityIdentity(mockedSafeClient({ threshold: 3n }), AUTHORITY),
    ).resolves.toEqual({ kind: "contract" });
    await expect(
      readAuthorityIdentity(mockedSafeClient({ version: "9.9.9" }), AUTHORITY),
    ).resolves.toEqual({ kind: "contract" });
  });

  it("recognizes only the exact 23-byte EIP-7702 delegation designator as an EOA", async () => {
    const delegated = {
      getBytecode: vi.fn().mockResolvedValue(DELEGATED_EOA_CODE),
    } as unknown as PublicClient;
    await expect(readAuthorityIdentity(delegated, AUTHORITY)).resolves.toEqual({
      kind: "eoa",
      delegation: FALLBACK,
    });

    const mixedCaseDelegation = {
      getBytecode: vi.fn().mockResolvedValue("0xEF0100aAbBcCdDeEfF0011223344556677889900112233"),
    } as unknown as PublicClient;
    await expect(readAuthorityIdentity(mixedCaseDelegation, AUTHORITY)).resolves.toMatchObject({
      kind: "eoa",
    });

    for (const malformed of [
      "0xef0100",
      PREFIXED_CONTRACT_CODE,
      `0xef0101${DELEGATED_EOA_CODE.slice(8)}`,
      `0xef0100${"zz".repeat(20)}`,
      `0Xef0100${FALLBACK.slice(2)}`,
    ] as Hex[]) {
      const client = {
        getBytecode: vi.fn().mockResolvedValue(malformed),
      } as unknown as PublicClient;
      await expect(readAuthorityIdentity(client, AUTHORITY)).resolves.toEqual({
        kind: "contract",
      });
    }

    const nonHex = {
      getBytecode: vi.fn().mockResolvedValue(null),
    } as unknown as PublicClient;
    await expect(readAuthorityIdentity(nonHex, AUTHORITY)).resolves.toEqual({
      kind: "contract",
    });
  });

  it("keeps failed live reads unknown instead of treating them as EOAs", async () => {
    const bytecodeFailure = {
      getBytecode: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    } as unknown as PublicClient;
    await expect(readAuthorityIdentity(bytecodeFailure, AUTHORITY)).resolves.toBeNull();

    const policyFailure = mockedSafeClient();
    vi.mocked(policyFailure.request).mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(readAuthorityIdentity(policyFailure, AUTHORITY)).resolves.toBeNull();
  });

  it("leaves a live Ethereum authority local, regardless of account type", async () => {
    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 1,
        sourceClient: eoaClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "valid-local", allowed: true });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 1,
        sourceClient: mockedSafeClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "valid-local", allowed: true });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 1,
        sourceClient: eoaClient([AUTHORITY]),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "valid-local", allowed: true });
  });

  it("distinguishes a deployable missing mainnet Safe from policy failures", async () => {
    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient(),
        mainnetClient: eoaClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "missing-mainnet-safe", allowed: false });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient(),
        mainnetClient: mockedSafeClient({ fallbackHandler: OTHER_FALLBACK }),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "authority-mismatch", allowed: false });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient({ modules: [MODULE] }),
        mainnetClient: mockedSafeClient({ modules: [MODULE] }),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "unsafe-safe-policy", allowed: false });
  });

  it("requires every Safe owner to be a plain or exact delegated EOA on both chains", async () => {
    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient(),
        mainnetClient: eoaClient([OWNER_A]),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "contract-owner", allowed: false });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient({ contractOwners: [OWNER_A] }),
        mainnetClient: mockedSafeClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "contract-owner", allowed: false });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient({ delegatedOwners: [OWNER_A] }),
        mainnetClient: mockedSafeClient({ delegatedOwners: [OWNER_B] }),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "valid-safe", allowed: true });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient({ prefixedContractOwners: [OWNER_A] }),
        mainnetClient: mockedSafeClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "contract-owner", allowed: false });
  });

  it("accepts matching hardened Safes and same-address EOAs across chains", async () => {
    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient(),
        mainnetClient: mockedSafeClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "valid-safe", allowed: true });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 10,
        sourceClient: eoaClient(),
        mainnetClient: eoaClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "valid-eoa", allowed: true });

    for (const [sourceCode, mainnetCode] of [
      [DELEGATED_EOA_CODE, undefined],
      [undefined, DELEGATED_EOA_CODE],
      [DELEGATED_EOA_CODE, OTHER_DELEGATED_EOA_CODE],
    ] as const) {
      await expect(
        readCrossChainHandleAuthority({
          sourceChainId: 10,
          sourceClient: eoaClient([], sourceCode),
          mainnetClient: eoaClient([], mainnetCode),
          authority: AUTHORITY,
        }),
      ).resolves.toMatchObject({ status: "valid-eoa", allowed: true });
    }

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 10,
        sourceClient: eoaClient([], PREFIXED_CONTRACT_CODE),
        mainnetClient: eoaClient(),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "source-contract", allowed: false });

    await expect(
      readCrossChainHandleAuthority({
        sourceChainId: 8453,
        sourceClient: mockedSafeClient(),
        mainnetClient: eoaClient([], DELEGATED_EOA_CODE),
        authority: AUTHORITY,
      }),
    ).resolves.toMatchObject({ status: "authority-mismatch", allowed: false });
  });
});

describe("Ethereum/SafeL2 singleton pairing", () => {
  const L1_SINGLETON = SAFE_L1_L2_SINGLETON_PAIRS[0][0];
  const L2_SINGLETON = SAFE_L1_L2_SINGLETON_PAIRS[0][1];
  const L1_CODE = "0x60106000" as Hex;
  const L2_CODE = "0x60116000" as Hex;

  // Safe deploys the Ethereum singleton on chain 1 and SafeL2 everywhere
  // else from one initializer, so the two halves must read as one release.
  const ethereumSafe = safeIdentity({
    singleton: L1_SINGLETON,
    singletonCodeHash: keccak256(L1_CODE),
    version: "1.4.1",
  });
  const l2Safe = safeIdentity({
    singleton: L2_SINGLETON,
    singletonCodeHash: keccak256(L2_CODE),
    version: "1.4.1",
  });

  it("matches a Safe deployed the canonical way on both chains", () => {
    expect(authorityIdentitiesMatch(l2Safe, ethereumSafe)).toBe(true);
  });

  it("still requires identical runtime when the singleton address is shared", () => {
    expect(
      authorityIdentitiesMatch(ethereumSafe, {
        ...ethereumSafe,
        singletonCodeHash: keccak256(L2_CODE),
      }),
    ).toBe(false);
  });

  it("rejects a singleton from a different release", () => {
    expect(
      authorityIdentitiesMatch(l2Safe, {
        ...ethereumSafe,
        singleton: RECOGNIZED_SAFE_RELEASES[0].singletons[0],
      }),
    ).toBe(false);
  });

  it("does not let a paired singleton excuse divergent control", () => {
    expect(authorityIdentitiesMatch(l2Safe, { ...ethereumSafe, threshold: 1 })).toBe(false);
  });
});
