import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  zeroAddress,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  isEip7702DelegatedEoaRuntime,
  isEoaAuthorityRuntime,
  isRecognizedSafeDeployment,
  isRecognizedSafeProxyCodeHash,
  isRuntimeBytecode,
  pairedSafeL2Singleton,
  readCrossChainHandleAuthority,
  recognizedSafeVersionForSingleton,
  SAFE_CANONICAL_PAYMENT_RECEIVER,
  SAFE_TO_L2_SETUP_ADDRESS,
  SAFE_TO_L2_SETUP_CODE_HASH,
  safeSingletonsAreEquivalent,
  type CrossChainHandleAuthority,
  type SafeAuthorityIdentity,
} from "./cross-chain-authority";
import { SAFE_TX_SERVICE_PREFIX } from "./safeOwners";

export const safeSetupAbi = [
  {
    type: "function",
    name: "setup",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owners", type: "address[]" },
      { name: "_threshold", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
      { name: "fallbackHandler", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const safeToL2SetupAbi = [
  {
    type: "function",
    name: "setupToL2",
    stateMutability: "nonpayable",
    inputs: [{ name: "l2Singleton", type: "address" }],
    outputs: [],
  },
] as const;

export const safeProxyFactoryAbi = [
  {
    type: "function",
    name: "createProxyWithNonce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_singleton", type: "address" },
      { name: "initializer", type: "bytes" },
      { name: "saltNonce", type: "uint256" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
] as const;

export type SafeCreation = {
  factory: Address;
  singleton: Address;
  initializer: Hex;
  saltNonce: bigint;
};

export function safeCreationUrl(chainId: number, safe: string): string | null {
  const prefix = SAFE_TX_SERVICE_PREFIX[chainId];
  if (!prefix || !isAddress(safe)) return null;
  return `https://api.safe.global/tx-service/${prefix}/api/v1/safes/${getAddress(safe)}/creation/`;
}

/** Strictly parse the untrusted Safe Transaction Service creation payload. */
export function parseSafeCreationPayload(payload: unknown): SafeCreation | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (
    typeof data.factoryAddress !== "string" ||
    typeof data.masterCopy !== "string" ||
    typeof data.setupData !== "string" ||
    typeof data.saltNonce !== "string" ||
    !isAddress(data.factoryAddress) ||
    !isAddress(data.masterCopy) ||
    !isHex(data.setupData, { strict: true }) ||
    data.setupData.length < 10 ||
    !/^\d+$/.test(data.saltNonce)
  ) {
    return null;
  }

  try {
    const factory = getAddress(data.factoryAddress);
    const singleton = getAddress(data.masterCopy);
    if (!isRecognizedSafeDeployment(factory, singleton)) return null;
    return {
      factory,
      singleton,
      initializer: data.setupData,
      saltNonce: BigInt(data.saltNonce),
    };
  } catch {
    return null;
  }
}

/**
 * Read the Safe's original CREATE2 inputs from its source-chain service. The
 * source is mandatory: accepting a same-address record from another chain
 * could replay unrelated creation data.
 */
export async function fetchSafeCreation(
  safe: Address,
  source: number | readonly number[],
  fetcher: typeof fetch = fetch,
): Promise<SafeCreation | null> {
  if (!isAddress(safe)) return null;
  const sourceChainIds = typeof source === "number" ? [source] : source;
  if (sourceChainIds.length !== 1) return null;
  const [sourceChainId] = sourceChainIds;
  const url = safeCreationUrl(sourceChainId, safe);
  if (!url) return null;
  try {
    const response = await fetcher(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return parseSafeCreationPayload(await response.json());
  } catch {
    return null;
  }
}

type SafeCreationValidationReason =
  | "unrecognized-deployment"
  | "unsafe-current-policy"
  | "malformed-initializer"
  | "initializer-policy-mismatch"
  | "unsafe-initializer";

export type SafeCreationValidation =
  | {
      valid: true;
      owners: Address[];
      threshold: number;
      fallbackHandler: Address;
    }
  | { valid: false; reason: SafeCreationValidationReason };

function ownerSet(owners: readonly Address[]): string[] | null {
  if (!owners.length) return null;
  const normalized: string[] = [];
  for (const owner of owners) {
    if (!isAddress(owner) || isAddressEqual(owner, zeroAddress)) return null;
    normalized.push(owner.toLowerCase());
  }
  const unique = [...new Set(normalized)].sort();
  return unique.length === normalized.length ? unique : null;
}

function sameOwners(left: readonly Address[], right: readonly Address[]): boolean {
  const leftSet = ownerSet(left);
  const rightSet = ownerSet(right);
  return Boolean(
    leftSet &&
    rightSet &&
    leftSet.length === rightSet.length &&
    leftSet.every((owner, index) => owner === rightSet[index]),
  );
}

/** True when this creation's initializer delegatecalls SafeToL2Setup. */
function usesSafeToL2Setup(creation: SafeCreation): boolean {
  try {
    const decoded = decodeFunctionData({ abi: safeSetupAbi, data: creation.initializer });
    return (
      decoded.functionName === "setup" &&
      isAddressEqual(decoded.args[2] as Address, SAFE_TO_L2_SETUP_ADDRESS)
    );
  } catch {
    return false;
  }
}

/**
 * Byte-exact `setupToL2(l2Singleton)` naming the SafeL2 counterpart of the
 * initializer's own singleton. Nothing else may be delegatecalled at setup.
 */
function isExactSetupToL2Call(setupData: Hex, singleton: Address): boolean {
  const l2Singleton = pairedSafeL2Singleton(singleton);
  if (!l2Singleton) return false;
  const expected = encodeFunctionData({
    abi: safeToL2SetupAbi,
    functionName: "setupToL2",
    args: [l2Singleton],
  });
  return setupData.toLowerCase() === expected.toLowerCase();
}

/**
 * Validate that replaying the service-provided initializer creates today's
 * source Safe policy—not the historical owners from its original creation.
 * Delegatecall setup hooks and setup payments are rejected because they could
 * mutate policy or spend counterfactually prefunded assets during deployment.
 */
export function validateSafeCreationForCurrentPolicy(
  creation: SafeCreation,
  currentSafe: SafeAuthorityIdentity,
): SafeCreationValidation {
  if (!isRecognizedSafeDeployment(creation.factory, creation.singleton)) {
    return { valid: false, reason: "unrecognized-deployment" };
  }
  if (
    currentSafe.hasModules ||
    !isAddressEqual(currentSafe.guard, zeroAddress) ||
    !currentSafe.ownersAreEoas ||
    !isRecognizedSafeProxyCodeHash(currentSafe.proxyCodeHash) ||
    recognizedSafeVersionForSingleton(currentSafe.singleton) !== currentSafe.version ||
    (isAddressEqual(currentSafe.fallbackHandler, zeroAddress)
      ? currentSafe.fallbackHandlerCodeHash !== null
      : currentSafe.fallbackHandlerCodeHash === null)
  ) {
    return { valid: false, reason: "unsafe-current-policy" };
  }
  if (!safeSingletonsAreEquivalent(creation.singleton, currentSafe.singleton)) {
    return { valid: false, reason: "initializer-policy-mismatch" };
  }

  try {
    const decoded = decodeFunctionData({ abi: safeSetupAbi, data: creation.initializer });
    if (decoded.functionName !== "setup" || !decoded.args) {
      return { valid: false, reason: "malformed-initializer" };
    }
    const [
      ownersRaw,
      thresholdRaw,
      to,
      setupData,
      fallbackHandler,
      paymentToken,
      payment,
      paymentReceiver,
    ] = decoded.args;
    const owners = [...ownersRaw] as Address[];
    const threshold = Number(thresholdRaw);

    // Reject noncanonical ABI encodings (including ignored trailing data).
    const canonical = encodeFunctionData({
      abi: safeSetupAbi,
      functionName: "setup",
      args: decoded.args,
    });
    if (canonical.toLowerCase() !== creation.initializer.toLowerCase()) {
      return { valid: false, reason: "malformed-initializer" };
    }
    if (
      !ownerSet(owners) ||
      !Number.isSafeInteger(threshold) ||
      threshold <= 0 ||
      threshold > owners.length
    ) {
      return { valid: false, reason: "malformed-initializer" };
    }
    if (
      threshold !== currentSafe.threshold ||
      !sameOwners(owners, currentSafe.owners) ||
      !isAddressEqual(fallbackHandler, currentSafe.fallbackHandler)
    ) {
      return { valid: false, reason: "initializer-policy-mismatch" };
    }
    // The only accepted delegatecall hook is the canonical SafeToL2Setup
    // installing this release's own SafeL2 counterpart. Any other target,
    // selector, or argument stays rejected, as does a non-zero payment.
    const usesSafeToL2Setup = isAddressEqual(to, SAFE_TO_L2_SETUP_ADDRESS);
    if (usesSafeToL2Setup && !isExactSetupToL2Call(setupData, creation.singleton)) {
      return { valid: false, reason: "unsafe-initializer" };
    }
    if (
      (!usesSafeToL2Setup && (!isAddressEqual(to, zeroAddress) || setupData !== "0x")) ||
      !isAddressEqual(paymentToken, zeroAddress) ||
      payment !== 0n ||
      (!isAddressEqual(paymentReceiver, zeroAddress) &&
        !isAddressEqual(paymentReceiver, SAFE_CANONICAL_PAYMENT_RECEIVER))
    ) {
      return { valid: false, reason: "unsafe-initializer" };
    }
    return {
      valid: true,
      owners: owners.map((owner) => getAddress(owner)),
      threshold,
      fallbackHandler: getAddress(fallbackHandler),
    };
  } catch {
    return { valid: false, reason: "malformed-initializer" };
  }
}

export type SafeProxyFactoryCall = {
  target: Address;
  data: Hex;
  abi: typeof safeProxyFactoryAbi;
  functionName: "createProxyWithNonce";
  args: readonly [Address, Hex, bigint];
};

/** Exact reviewed call which reproduces a Safe's CREATE2 address. */
export function buildSafeProxyFactoryCall(creation: SafeCreation): SafeProxyFactoryCall {
  if (!isRecognizedSafeDeployment(creation.factory, creation.singleton)) {
    throw new Error("The Safe creation does not use a recognized factory and singleton pair.");
  }
  const args = [creation.singleton, creation.initializer, creation.saltNonce] as const;
  return {
    target: creation.factory,
    abi: safeProxyFactoryAbi,
    functionName: "createProxyWithNonce",
    args,
    data: encodeFunctionData({
      abi: safeProxyFactoryAbi,
      functionName: "createProxyWithNonce",
      args,
    }),
  };
}

export type SafeDeploymentSimulation =
  | { valid: true; call: SafeProxyFactoryCall }
  | {
      valid: false;
      reason:
        | "invalid-creation"
        | "rpc-error"
        | "factory-unavailable"
        | "singleton-unavailable"
        | "singleton-mismatch"
        | "fallback-handler-unavailable"
        | "delegated-fallback-handler"
        | "fallback-handler-mismatch"
        | "contract-owner"
        | "address-occupied"
        | "simulation-failed"
        | "unexpected-address";
    };

function hasBytecode(code: Hex | undefined): boolean {
  return Boolean(code && code !== "0x");
}

/** Pure validation for the return value of createProxyWithNonce simulation. */
export function simulatedSafeAddressMatchesExpected(
  simulated: unknown,
  expectedSafe: Address,
): boolean {
  return (
    typeof simulated === "string" &&
    isAddress(simulated) &&
    isAddressEqual(getAddress(simulated), expectedSafe)
  );
}

/**
 * Check destination preconditions and eth_call the exact factory request.
 * The returned proxy must be the authority address before a wallet write may
 * be requested.
 */
export async function simulateSafeProxyDeployment({
  client,
  creation,
  expectedSafe,
  currentSafe,
  account,
}: {
  client: PublicClient;
  creation: SafeCreation;
  expectedSafe: Address;
  currentSafe: SafeAuthorityIdentity;
  account?: Address | Account;
}): Promise<SafeDeploymentSimulation> {
  let call: SafeProxyFactoryCall;
  let destinationOwners: Address[];
  let destinationFallbackHandler: Address;
  try {
    if (!validateSafeCreationForCurrentPolicy(creation, currentSafe).valid) {
      return { valid: false, reason: "invalid-creation" };
    }
    destinationOwners = currentSafe.owners;
    destinationFallbackHandler = currentSafe.fallbackHandler;
    call = buildSafeProxyFactoryCall(creation);
  } catch {
    return { valid: false, reason: "invalid-creation" };
  }

  let expectedCode: Hex | undefined;
  let factoryCode: Hex | undefined;
  let singletonCode: Hex | undefined;
  let setupLibraryCode: Hex | undefined;
  let ownerCode: (Hex | undefined)[];
  let fallbackHandlerCode: Hex | undefined;
  try {
    const addresses = [
      expectedSafe,
      creation.factory,
      creation.singleton,
      SAFE_TO_L2_SETUP_ADDRESS,
      ...destinationOwners,
    ];
    if (!isAddressEqual(destinationFallbackHandler, zeroAddress)) {
      addresses.push(destinationFallbackHandler);
    }
    const code = await Promise.all(addresses.map((address) => client.getBytecode({ address })));
    if (code.some((runtime) => runtime !== undefined && !isRuntimeBytecode(runtime))) {
      return { valid: false, reason: "rpc-error" };
    }
    [expectedCode, factoryCode, singletonCode, setupLibraryCode] = code;
    ownerCode = code.slice(4, 4 + destinationOwners.length);
    fallbackHandlerCode = isAddressEqual(destinationFallbackHandler, zeroAddress)
      ? undefined
      : code.at(-1);
  } catch {
    return { valid: false, reason: "rpc-error" };
  }
  if (hasBytecode(expectedCode)) return { valid: false, reason: "address-occupied" };
  if (!hasBytecode(factoryCode)) return { valid: false, reason: "factory-unavailable" };
  if (!hasBytecode(singletonCode)) return { valid: false, reason: "singleton-unavailable" };
  // A paired Ethereum/SafeL2 singleton is a different runtime by construction,
  // so bind it by its allow-listed address instead of the source Safe's hash.
  if (
    isAddressEqual(creation.singleton, currentSafe.singleton)
      ? keccak256(singletonCode!) !== currentSafe.singletonCodeHash
      : !safeSingletonsAreEquivalent(creation.singleton, currentSafe.singleton)
  ) {
    return { valid: false, reason: "singleton-mismatch" };
  }
  // The initializer delegatecalls SafeToL2Setup on the destination chain, so
  // that library's runtime must be the canonical one there too.
  if (
    usesSafeToL2Setup(creation) &&
    (!hasBytecode(setupLibraryCode) || keccak256(setupLibraryCode!) !== SAFE_TO_L2_SETUP_CODE_HASH)
  ) {
    return { valid: false, reason: "singleton-mismatch" };
  }
  if (ownerCode.some((code) => !isEoaAuthorityRuntime(code))) {
    return { valid: false, reason: "contract-owner" };
  }
  if (!isAddressEqual(destinationFallbackHandler, zeroAddress)) {
    if (!hasBytecode(fallbackHandlerCode)) {
      return { valid: false, reason: "fallback-handler-unavailable" };
    }
    if (isEip7702DelegatedEoaRuntime(fallbackHandlerCode)) {
      return { valid: false, reason: "delegated-fallback-handler" };
    }
    if (
      !currentSafe.fallbackHandlerCodeHash ||
      keccak256(fallbackHandlerCode!) !== currentSafe.fallbackHandlerCodeHash
    ) {
      return { valid: false, reason: "fallback-handler-mismatch" };
    }
  }

  try {
    const simulation = await client.simulateContract({
      account,
      address: creation.factory,
      abi: safeProxyFactoryAbi,
      functionName: "createProxyWithNonce",
      args: call.args,
    });
    return simulatedSafeAddressMatchesExpected(simulation.result, expectedSafe)
      ? { valid: true, call }
      : { valid: false, reason: "unexpected-address" };
  } catch {
    return { valid: false, reason: "simulation-failed" };
  }
}

/**
 * Mandatory post-receipt check: the newly deployed Ethereum Safe must still
 * satisfy the full live source/mainnet parity policy.
 */
export function verifySafeDeploymentAfterReceipt({
  sourceChainId,
  sourceClient,
  mainnetClient,
  authority,
}: {
  sourceChainId: number;
  sourceClient: PublicClient;
  mainnetClient: PublicClient;
  authority: Address;
}): Promise<CrossChainHandleAuthority> {
  return readCrossChainHandleAuthority({
    sourceChainId,
    sourceClient,
    mainnetClient,
    authority,
  });
}
