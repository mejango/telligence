import {
  encodeFunctionData,
  getAddress,
  hexToString,
  isAddress,
  isAddressEqual,
  keccak256,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

/** Safe's linked-list sentinel for the first page of enabled modules. */
export const SAFE_MODULES_SENTINEL = "0x0000000000000000000000000000000000000001" as Address;

/** Storage locations declared by Safe's FallbackManager and GuardManager. */
export const SAFE_FALLBACK_HANDLER_STORAGE_SLOT = keccak256(
  toHex("fallback_manager.handler.address"),
);
export const SAFE_GUARD_STORAGE_SLOT = keccak256(toHex("guard_manager.guard.address"));

const SAFE_PROXY_SINGLETON_STORAGE_SLOT = toHex(0, { size: 32 });
const MAX_SAFE_OWNERS = 50;
const SAFE_OWNERS_READ_GAS = "0x7a120";
const SAFE_POLICY_READ_GAS = "0x249f0";

export type AuthorityReadOptions = { blockNumber?: bigint };

function rpcBlockTag(blockNumber?: bigint): Hex | "latest" {
  return blockNumber === undefined ? "latest" : toHex(blockNumber);
}

/** keccak256(runtime bytecode) returned by canonical v1.3.0/v1.4.1 factories. */
const RECOGNIZED_SAFE_PROXY_CODE_HASHES = [
  "0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000",
  "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
] as const satisfies readonly Hex[];

const recognizedSafeProxyCodeHashes = new Set<string>(
  RECOGNIZED_SAFE_PROXY_CODE_HASHES.map((hash) => hash.toLowerCase()),
);

/**
 * Official released singleton/factory pairs used by supported contemporary
 * Safe deployments. Addresses come from @safe-global/safe-deployments.
 *
 * A hard allow-list is intentional: an arbitrary contract which merely
 * implements getOwners/getThreshold must not become a handle authority.
 */
export const RECOGNIZED_SAFE_RELEASES = [
  {
    version: "1.3.0",
    singletons: [
      "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552",
      "0x69f4D1788e39c87893C980c06EdF4b7f686e2938",
      "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
      "0xfb1bffC9d739B8D520DaF37dF666da4C687191EA",
    ],
    factories: [
      "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
      "0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC",
    ],
  },
  {
    version: "1.4.1",
    singletons: [
      "0x41675C099F32341bf84BFc5382aF534df5C7461a",
      "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    ],
    factories: ["0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"],
  },
] as const satisfies readonly {
  version: string;
  singletons: readonly Address[];
  factories: readonly Address[];
}[];

export type RecognizedSafeVersion = (typeof RECOGNIZED_SAFE_RELEASES)[number]["version"];

/**
 * Safe's canonical 1.4.1 creation calls `SafeToL2Setup.setupToL2` as `setup`'s
 * delegatecall hook. That library repoints slot zero at SafeL2 on every chain
 * except Ethereum, so one initializer produces the same address with a
 * different — but paired — singleton per chain. Treating the pair as a
 * mismatch would reject every Safe the Safe interface deploys on an L2.
 */
export const SAFE_TO_L2_SETUP_ADDRESS = "0xBD89A1CE4DDe368FFAB0eC35506eEcE0b1fFdc54" as Address;

/** keccak256 of SafeToL2Setup's runtime, identical on every canonical chain. */
export const SAFE_TO_L2_SETUP_CODE_HASH =
  "0x2f25df28caf984366ee584e13241707e85dcd5a6ea0c14267928dafc1fd6274b" as Hex;

/**
 * Safe's vanity `paymentReceiver` marker. It is inert because the accepted
 * initializer subset still requires a zero `payment`.
 */
export const SAFE_CANONICAL_PAYMENT_RECEIVER =
  "0x5afe7a11e7000000000000000000000000000000" as Address;

/** Ethereum singleton to its SafeL2 counterpart, per recognized release. */
export const SAFE_L1_L2_SINGLETON_PAIRS = [
  ["0x41675C099F32341bf84BFc5382aF534df5C7461a", "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"],
] as const satisfies readonly (readonly [Address, Address])[];

/** The SafeL2 singleton `SafeToL2Setup` may install for `singleton`, if any. */
export function pairedSafeL2Singleton(singleton: Address): Address | null {
  const pair = SAFE_L1_L2_SINGLETON_PAIRS.find(([l1]) => isAddressEqual(l1, singleton));
  return pair ? getAddress(pair[1]) : null;
}

/**
 * True when two singletons describe one recognized release: the same address,
 * or its exact Ethereum/SafeL2 pair. Both halves stay allow-listed elsewhere.
 */
export function safeSingletonsAreEquivalent(left: Address, right: Address): boolean {
  if (isAddressEqual(left, right)) return true;
  return SAFE_L1_L2_SINGLETON_PAIRS.some(
    ([l1, l2]) =>
      (isAddressEqual(l1, left) && isAddressEqual(l2, right)) ||
      (isAddressEqual(l1, right) && isAddressEqual(l2, left)),
  );
}

const safeProxyAbi = [
  {
    type: "function",
    name: "masterCopy",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "VERSION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getModulesPaginated",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "address" },
      { name: "pageSize", type: "uint256" },
    ],
    outputs: [
      { name: "array", type: "address[]" },
      { name: "next", type: "address" },
    ],
  },
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const getSafeOwnersData = encodeFunctionData({
  abi: safeProxyAbi,
  functionName: "getOwners",
});
const getSafeMasterCopyData = encodeFunctionData({
  abi: safeProxyAbi,
  functionName: "masterCopy",
});
const getSafeVersionData = encodeFunctionData({ abi: safeProxyAbi, functionName: "VERSION" });
const getSafeThresholdData = encodeFunctionData({
  abi: safeProxyAbi,
  functionName: "getThreshold",
});
const getSafeModulesData = encodeFunctionData({
  abi: safeProxyAbi,
  functionName: "getModulesPaginated",
  args: [SAFE_MODULES_SENTINEL, 1n],
});
const getSafeNonceData = encodeFunctionData({ abi: safeProxyAbi, functionName: "nonce" });

export type SafeAuthorityIdentity = {
  kind: "safe";
  proxyCodeHash: Hex;
  singleton: Address;
  singletonCodeHash: Hex;
  version: RecognizedSafeVersion;
  owners: Address[];
  threshold: number;
  fallbackHandler: Address;
  fallbackHandlerCodeHash: Hex | null;
  guard: Address;
  hasModules: boolean;
  /** All owners are plain or exact EIP-7702-delegated EOAs on this chain. */
  ownersAreEoas: boolean;
};

type EoaAuthorityIdentity = {
  kind: "eoa";
  /** Present only when the account has an exact EIP-7702 delegation designator. */
  delegation?: Address;
};

export type AuthorityIdentity = EoaAuthorityIdentity | { kind: "contract" } | SafeAuthorityIdentity;

function safeReleaseForSingleton(singleton: Address) {
  return RECOGNIZED_SAFE_RELEASES.find((release) =>
    release.singletons.some((candidate) => isAddressEqual(candidate, singleton)),
  );
}

export function recognizedSafeVersionForSingleton(
  singleton: Address,
): RecognizedSafeVersion | null {
  return safeReleaseForSingleton(singleton)?.version ?? null;
}

export function isRecognizedSafeProxyCodeHash(codeHash: Hex): boolean {
  return recognizedSafeProxyCodeHashes.has(codeHash.toLowerCase());
}

export function isRecognizedSafeDeployment(factory: Address, singleton: Address): boolean {
  const release = safeReleaseForSingleton(singleton);
  return Boolean(release?.factories.some((candidate) => isAddressEqual(candidate, factory)));
}

function addressFromStorageWord(word: Hex | undefined): Address | null {
  if (!word || !/^0x[\da-fA-F]{64}$/.test(word)) return null;
  if (!/^0{24}$/i.test(word.slice(2, 26))) return null;
  const value = `0x${word.slice(26)}`;
  return isAddress(value) ? getAddress(value) : null;
}

function normalizedOwnerSet(owners: readonly Address[]): string[] | null {
  if (!owners.length || owners.length > MAX_SAFE_OWNERS) return null;
  const normalized: string[] = [];
  for (const owner of owners) {
    if (!isAddress(owner) || isAddressEqual(owner, zeroAddress)) return null;
    normalized.push(owner.toLowerCase());
  }
  const unique = [...new Set(normalized)].sort();
  return unique.length === normalized.length ? unique : null;
}

function hasBytecode(code: Hex | undefined): boolean {
  return Boolean(code && code !== "0x");
}

/** Validate the byte-aligned hex shape an eth_getCode response must have. */
export function isRuntimeBytecode(code: unknown): code is Hex {
  return typeof code === "string" && /^0x(?:[\dA-Fa-f]{2})*$/.test(code);
}

/**
 * EIP-7702's complete delegation designator is exactly 0xef0100 followed by
 * one 20-byte implementation address. A normal contract which merely shares
 * that prefix must remain contract code and fail the EOA authority policy.
 */
export function isEip7702DelegatedEoaRuntime(code: unknown): code is Hex {
  return typeof code === "string" && /^0x[eE][fF]0100[\dA-Fa-f]{40}$/.test(code);
}

/** True only for a code-free EOA or an exact EIP-7702 delegation designator. */
export function isEoaAuthorityRuntime(code: unknown): boolean {
  return code === undefined || code === "0x" || isEip7702DelegatedEoaRuntime(code);
}

/**
 * Safe.getOwners walks a storage linked list and returns a dynamic array. A
 * crafted proxy can make that list enormous, so never let viem's generic ABI
 * decoder allocate from an attacker-controlled length. The raw RPC response
 * is gas-capped and structurally bounded before any owner array is created.
 */
async function readBoundedSafeOwners(
  client: PublicClient,
  authority: Address,
  blockNumber?: bigint,
): Promise<Address[] | null> {
  const body = await readBoundedSafeCall(
    client,
    authority,
    getSafeOwnersData,
    SAFE_OWNERS_READ_GAS,
    64 + MAX_SAFE_OWNERS * 32,
    blockNumber,
  );
  if (!body || body.length < 128 || body.slice(0, 64) !== toHex(32n, { size: 32 }).slice(2)) {
    return null;
  }

  const length = BigInt(`0x${body.slice(64, 128)}`);
  if (length === 0n || length > BigInt(MAX_SAFE_OWNERS)) return null;
  const requiredHexLength = 128 + Number(length) * 64;
  if (body.length < requiredHexLength) return null;

  const owners: Address[] = [];
  for (let index = 0; index < Number(length); index += 1) {
    const word = body.slice(128 + index * 64, 192 + index * 64);
    if (!/^0{24}[\da-fA-F]{40}$/.test(word)) return null;
    const owner = `0x${word.slice(24)}`;
    if (!isAddress(owner)) return null;
    owners.push(getAddress(owner));
  }
  return owners;
}

async function readBoundedSafeCall(
  client: PublicClient,
  authority: Address,
  data: Hex,
  gas: Hex,
  maxBytes: number,
  blockNumber?: bigint,
): Promise<string | null> {
  const raw = await client.request({
    method: "eth_call",
    params: [{ to: authority, data, gas }, rpcBlockTag(blockNumber)],
  });
  if (typeof raw !== "string" || !/^0x[\da-fA-F]*$/.test(raw) || raw.length % 2 !== 0) {
    return null;
  }

  const body = raw.slice(2);
  return body.length <= maxBytes * 2 ? body : null;
}

async function readSafeMasterCopy(
  client: PublicClient,
  authority: Address,
  blockNumber?: bigint,
): Promise<Address | null> {
  const body = await readBoundedSafeCall(
    client,
    authority,
    getSafeMasterCopyData,
    SAFE_POLICY_READ_GAS,
    32,
    blockNumber,
  );
  return body?.length === 64 ? addressFromStorageWord(`0x${body}`) : null;
}

async function readSafeVersion(
  client: PublicClient,
  authority: Address,
  blockNumber?: bigint,
): Promise<string | null> {
  const body = await readBoundedSafeCall(
    client,
    authority,
    getSafeVersionData,
    SAFE_POLICY_READ_GAS,
    96,
    blockNumber,
  );
  if (!body || body.length < 128 || body.slice(0, 64) !== toHex(32n, { size: 32 }).slice(2)) {
    return null;
  }
  const length = BigInt(`0x${body.slice(64, 128)}`);
  if (length > 32n || body.length < 128 + Number(length) * 2) return null;
  try {
    return hexToString(`0x${body.slice(128, 128 + Number(length) * 2)}`);
  } catch {
    return null;
  }
}

async function readSafeThreshold(
  client: PublicClient,
  authority: Address,
  blockNumber?: bigint,
): Promise<bigint | null> {
  const body = await readBoundedSafeCall(
    client,
    authority,
    getSafeThresholdData,
    SAFE_POLICY_READ_GAS,
    32,
    blockNumber,
  );
  return body?.length === 64 ? BigInt(`0x${body}`) : null;
}

/** Raw fixed-width Safe nonce read for queue surfaces; no CCIP or ABI allocation. */
export async function readBoundedSafeNonce(
  client: PublicClient,
  authority: Address,
  { blockNumber }: AuthorityReadOptions = {},
): Promise<bigint | null> {
  try {
    const body = await readBoundedSafeCall(
      client,
      authority,
      getSafeNonceData,
      SAFE_POLICY_READ_GAS,
      32,
      blockNumber,
    );
    return body?.length === 64 ? BigInt(`0x${body}`) : null;
  } catch {
    return null;
  }
}

async function readSafeModules(
  client: PublicClient,
  authority: Address,
  blockNumber?: bigint,
): Promise<readonly [Address[], Address] | null> {
  const body = await readBoundedSafeCall(
    client,
    authority,
    getSafeModulesData,
    SAFE_POLICY_READ_GAS,
    128,
    blockNumber,
  );
  if (!body || body.length < 192 || body.slice(0, 64) !== toHex(64n, { size: 32 }).slice(2)) {
    return null;
  }
  const next = addressFromStorageWord(`0x${body.slice(64, 128)}`);
  const length = BigInt(`0x${body.slice(128, 192)}`);
  if (!next || length > 1n || body.length < 192 + Number(length) * 64) return null;
  const modules: Address[] = [];
  if (length === 1n) {
    const moduleAddress = addressFromStorageWord(`0x${body.slice(192, 256)}`);
    if (!moduleAddress) return null;
    modules.push(moduleAddress);
  }
  return [modules, next];
}

/**
 * Classify one live address without consulting an indexer. Any failed RPC or
 * contract read is unknown (`null`) so callers cannot mistake an outage for an
 * EOA. A contract is a recognized Safe only when it has the Safe proxy storage
 * layout, points at an allow-listed singleton, reports that singleton's exact
 * version, and exposes a well-formed current policy.
 */
export async function readAuthorityIdentity(
  client: PublicClient,
  authority: Address,
  { blockNumber }: AuthorityReadOptions = {},
): Promise<AuthorityIdentity | null> {
  let proxyCode: Hex | undefined;
  try {
    proxyCode = await client.getBytecode({ address: authority, blockNumber });
  } catch {
    return null;
  }
  if (proxyCode !== undefined && !isRuntimeBytecode(proxyCode)) return { kind: "contract" };
  if (!hasBytecode(proxyCode)) return { kind: "eoa" };
  if (isEip7702DelegatedEoaRuntime(proxyCode)) {
    return {
      kind: "eoa",
      delegation: getAddress(`0x${proxyCode.slice(8).toLowerCase()}`),
    };
  }

  const proxyCodeHash = keccak256(proxyCode!);
  if (!isRecognizedSafeProxyCodeHash(proxyCodeHash)) {
    return { kind: "contract" };
  }

  let singleton: Address;
  let storedSingleton: Address | null;
  try {
    const [reportedSingleton, singletonWord] = await Promise.all([
      readSafeMasterCopy(client, authority, blockNumber),
      client.getStorageAt({
        address: authority,
        slot: SAFE_PROXY_SINGLETON_STORAGE_SLOT,
        blockNumber,
      }),
    ]);
    if (!reportedSingleton) return { kind: "contract" };
    singleton = reportedSingleton;
    storedSingleton = addressFromStorageWord(singletonWord);
  } catch {
    return null;
  }

  const release = safeReleaseForSingleton(singleton);
  if (!storedSingleton || !isAddressEqual(storedSingleton, singleton) || !release) {
    return { kind: "contract" };
  }

  try {
    // Establish that the recognized singleton address contains code before
    // making any call which the proxy delegates into it.
    const singletonCode = await client.getBytecode({ address: singleton, blockNumber });
    if (!hasBytecode(singletonCode)) return { kind: "contract" };

    const [version, thresholdRaw, ownersRaw, modulePage, fallbackWord, guardWord] =
      await Promise.all([
        readSafeVersion(client, authority, blockNumber),
        readSafeThreshold(client, authority, blockNumber),
        readBoundedSafeOwners(client, authority, blockNumber),
        readSafeModules(client, authority, blockNumber),
        client.getStorageAt({
          address: authority,
          slot: SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
          blockNumber,
        }),
        client.getStorageAt({ address: authority, slot: SAFE_GUARD_STORAGE_SLOT, blockNumber }),
      ]);

    if (version !== release.version || thresholdRaw === null || modulePage === null) {
      return { kind: "contract" };
    }

    const owners = ownersRaw ?? [];
    const normalizedOwners = normalizedOwnerSet(owners);
    const threshold = Number(thresholdRaw);
    const fallbackHandler = addressFromStorageWord(fallbackWord);
    const guard = addressFromStorageWord(guardWord);
    const [modulesRaw, nextRaw] = modulePage;
    const modules = Array.isArray(modulesRaw) ? (modulesRaw as Address[]) : [];

    if (
      !normalizedOwners ||
      !Number.isSafeInteger(threshold) ||
      threshold <= 0 ||
      threshold > owners.length ||
      !fallbackHandler ||
      !guard ||
      modules.length > 1 ||
      modules.some((module) => !isAddress(module) || isAddressEqual(module, zeroAddress)) ||
      !isAddress(nextRaw)
    ) {
      return { kind: "contract" };
    }

    const addressesToRead = [...owners];
    if (!isAddressEqual(fallbackHandler, zeroAddress)) {
      addressesToRead.push(fallbackHandler);
    }
    const relatedCode = await Promise.all(
      addressesToRead.map((address) => client.getBytecode({ address, blockNumber })),
    );
    const ownerCode = relatedCode.slice(0, owners.length);
    const fallbackHandlerCode = isAddressEqual(fallbackHandler, zeroAddress)
      ? undefined
      : relatedCode.at(-1);
    if (
      !isAddressEqual(fallbackHandler, zeroAddress) &&
      (!hasBytecode(fallbackHandlerCode) || isEip7702DelegatedEoaRuntime(fallbackHandlerCode))
    ) {
      // A Safe fallback handler is invoked as contract code. An EIP-7702
      // delegation designator identifies an EOA authority, not the immutable
      // handler runtime whose hash is allowed to participate in Safe parity.
      return { kind: "contract" };
    }
    return {
      kind: "safe",
      proxyCodeHash,
      singleton,
      singletonCodeHash: keccak256(singletonCode!),
      version: release.version,
      owners: owners.map((owner) => getAddress(owner)),
      threshold,
      fallbackHandler,
      fallbackHandlerCodeHash: fallbackHandlerCode ? keccak256(fallbackHandlerCode) : null,
      guard,
      hasModules: modules.length > 0 || !isAddressEqual(getAddress(nextRaw), SAFE_MODULES_SENTINEL),
      ownersAreEoas: ownerCode.every(isEoaAuthorityRuntime),
    };
  } catch {
    return null;
  }
}

/**
 * Pure policy comparison. Contract owners, modules, guards, singleton drift,
 * fallback-handler drift, duplicate owners, and threshold drift all fail
 * closed. Owner order and checksum casing do not matter.
 */
export function authorityIdentitiesMatch(
  source: AuthorityIdentity,
  destination: AuthorityIdentity,
): boolean {
  if (source.kind === "eoa" || destination.kind === "eoa") {
    return source.kind === "eoa" && destination.kind === "eoa";
  }
  if (source.kind !== "safe" || destination.kind !== "safe") return false;

  const sourceOwners = normalizedOwnerSet(source.owners);
  const destinationOwners = normalizedOwnerSet(destination.owners);
  return Boolean(
    sourceOwners &&
    destinationOwners &&
    source.ownersAreEoas &&
    destination.ownersAreEoas &&
    !source.hasModules &&
    !destination.hasModules &&
    isAddressEqual(source.guard, zeroAddress) &&
    isAddressEqual(destination.guard, zeroAddress) &&
    safeSingletonsAreEquivalent(source.singleton, destination.singleton) &&
    source.proxyCodeHash.toLowerCase() === destination.proxyCodeHash.toLowerCase() &&
    // Paired Ethereum/SafeL2 singletons are distinct implementations of one
    // release, so their runtimes only have to match when the address does.
    (!isAddressEqual(source.singleton, destination.singleton) ||
      source.singletonCodeHash.toLowerCase() === destination.singletonCodeHash.toLowerCase()) &&
    source.version === destination.version &&
    isAddressEqual(source.fallbackHandler, destination.fallbackHandler) &&
    source.fallbackHandlerCodeHash?.toLowerCase() ===
      destination.fallbackHandlerCodeHash?.toLowerCase() &&
    source.threshold === destination.threshold &&
    sourceOwners.length === destinationOwners.length &&
    sourceOwners.every((owner, index) => owner === destinationOwners[index]),
  );
}

export type CrossChainHandleAuthorityStatus =
  | "valid-local"
  | "valid-eoa"
  | "valid-safe"
  | "missing-mainnet-safe"
  | "source-contract"
  | "mainnet-contract"
  | "authority-mismatch"
  | "unsafe-safe-policy"
  | "contract-owner"
  | "unknown";

export type CrossChainHandleAuthority = {
  status: CrossChainHandleAuthorityStatus;
  allowed: boolean;
  source: AuthorityIdentity | null;
  mainnet: AuthorityIdentity | null;
};

async function addressesAreEoaAuthorities(
  client: PublicClient,
  addresses: readonly Address[],
  blockNumber?: bigint,
): Promise<boolean | null> {
  try {
    const code = await Promise.all(
      addresses.map((address) => client.getBytecode({ address, blockNumber })),
    );
    return code.every(isEoaAuthorityRuntime);
  } catch {
    return null;
  }
}

function verdict(
  status: CrossChainHandleAuthorityStatus,
  source: AuthorityIdentity | null,
  mainnet: AuthorityIdentity | null,
): CrossChainHandleAuthority {
  return {
    status,
    allowed: status === "valid-local" || status === "valid-eoa" || status === "valid-safe",
    source,
    mainnet,
  };
}

/**
 * Decide whether an authority may publish an Ethereum-canonical handle.
 *
 * Ethereum projects use their already-established live local authority without
 * a cross-chain restriction. L2 projects require the same plain or exact
 * EIP-7702-delegated EOA on Ethereum, or an exact module-free/guard-free Safe
 * policy at the same address. An undeployed
 * Ethereum Safe is its own UI-actionable state; every other uncertainty is
 * denied without guessing.
 */
export async function readCrossChainHandleAuthority({
  sourceChainId,
  sourceClient,
  mainnetClient,
  authority,
  sourceBlockNumber,
  mainnetBlockNumber,
}: {
  sourceChainId: number;
  sourceClient: PublicClient;
  mainnetClient?: PublicClient;
  authority: Address;
  sourceBlockNumber?: bigint;
  mainnetBlockNumber?: bigint;
}): Promise<CrossChainHandleAuthority> {
  if (sourceChainId === 1) {
    // There is no cross-chain equivalence question when the live project
    // authority and JBProjectHandles call are both on Ethereum. Upstream must
    // still establish that `authority` is the live owner/operator.
    return verdict("valid-local", null, null);
  }

  if (!mainnetClient) return verdict("unknown", null, null);
  const [source, mainnet] = await Promise.all([
    readAuthorityIdentity(sourceClient, authority, { blockNumber: sourceBlockNumber }),
    readAuthorityIdentity(mainnetClient, authority, { blockNumber: mainnetBlockNumber }),
  ]);
  if (!source || !mainnet) return verdict("unknown", source, mainnet);
  if (source.kind === "contract") return verdict("source-contract", source, mainnet);
  if (source.kind === "eoa") {
    if (mainnet.kind === "eoa") return verdict("valid-eoa", source, mainnet);
    if (mainnet.kind === "contract") return verdict("mainnet-contract", source, mainnet);
    return verdict("authority-mismatch", source, mainnet);
  }

  if (!source.ownersAreEoas) return verdict("contract-owner", source, mainnet);
  if (source.hasModules || !isAddressEqual(source.guard, zeroAddress)) {
    return verdict("unsafe-safe-policy", source, mainnet);
  }
  if (mainnet.kind === "eoa") {
    // An exact EIP-7702 marker occupies the address and cannot be treated as a
    // counterfactual Safe deployment target, even though it remains an EOA for
    // ECDSA authority matching.
    if (mainnet.delegation) return verdict("authority-mismatch", source, mainnet);
    const ownersAreMainnetEoas = await addressesAreEoaAuthorities(
      mainnetClient,
      source.owners,
      mainnetBlockNumber,
    );
    if (ownersAreMainnetEoas == null) return verdict("unknown", source, mainnet);
    if (!ownersAreMainnetEoas) return verdict("contract-owner", source, mainnet);
    return verdict("missing-mainnet-safe", source, mainnet);
  }
  if (mainnet.kind === "contract") return verdict("mainnet-contract", source, mainnet);
  if (!mainnet.ownersAreEoas) return verdict("contract-owner", source, mainnet);
  if (mainnet.hasModules || !isAddressEqual(mainnet.guard, zeroAddress)) {
    return verdict("unsafe-safe-policy", source, mainnet);
  }
  return authorityIdentitiesMatch(source, mainnet)
    ? verdict("valid-safe", source, mainnet)
    : verdict("authority-mismatch", source, mainnet);
}
