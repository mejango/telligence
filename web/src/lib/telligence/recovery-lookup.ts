import { isAddress, zeroAddress, type Address } from "viem";
import { computeFactoryAbi } from "./factory";

type RecoveryReader = {
  getChainId: () => Promise<number>;
  getCode: (args: { address: Address }) => Promise<`0x${string}` | undefined>;
  readContract: (args: {
    address: Address;
    abi: typeof computeFactoryAbi;
    functionName: "policyOf" | "vaultOf" | "creatorOf";
    args: readonly [bigint];
  }) => Promise<unknown>;
};
export type RecoveryProject = {
  revnetId: bigint;
  factoryAddress: Address;
  policyAddress: Address;
  vaultAddress: Address;
  creatorAddress: Address;
};

export function parseRecoveryProjectId(value: string) {
  if (!/^[1-9]\d{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n)
    throw new Error("Enter a positive Base project number.");
  return BigInt(value);
}

/**
 * A user-supplied Base RPC for reading the registry when the site's providers fail.
 * Empty means "use the site's default"; anything but a plain https URL is refused.
 */
export function parseRecoveryRpcUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const invalid = () =>
    new Error("Enter an https RPC URL without credentials, query parameters, or fragments.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  )
    throw invalid();
  return url.href;
}

export function configuredRecoveryFactory(
  value = process.env.NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS,
): Address {
  if (!value || !isAddress(value) || value.toLowerCase() === zeroAddress)
    throw new Error(
      "This web deployment has no pinned compute factory. Its operator must configure the verified Base factory before recovery can be opened here.",
    );
  return value;
}

/** Recover from the pinned onchain registry even when the hosted gateway is unavailable. */
export async function lookupRecoveryProject(
  client: RecoveryReader,
  factoryAddress: Address,
  revnetId: bigint,
): Promise<RecoveryProject> {
  configuredRecoveryFactory(factoryAddress);
  parseRecoveryProjectId(revnetId.toString());
  if ((await client.getChainId()) !== 8453) throw new Error("Recovery requires the Base network.");
  const factoryCode = await client.getCode({ address: factoryAddress });
  if (!factoryCode || factoryCode === "0x")
    throw new Error("The configured factory is not deployed on Base.");
  const [policyAddress, vaultAddress, creatorAddress] = await Promise.all(
    (["policyOf", "vaultOf", "creatorOf"] as const).map((functionName) =>
      client.readContract({
        address: factoryAddress,
        abi: computeFactoryAbi,
        functionName,
        args: [revnetId],
      }),
    ),
  );
  for (const value of [policyAddress, vaultAddress, creatorAddress]) {
    if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() === zeroAddress)
      throw new Error("This project is not registered with the configured compute factory.");
  }
  const contracts = [policyAddress, vaultAddress] as Address[];
  const code = await Promise.all(contracts.map((address) => client.getCode({ address })));
  if (code.some((bytes) => !bytes || bytes === "0x"))
    throw new Error("The registered recovery contracts are not deployed on Base.");
  return {
    revnetId,
    factoryAddress,
    policyAddress: policyAddress as Address,
    vaultAddress: vaultAddress as Address,
    creatorAddress: creatorAddress as Address,
  };
}
