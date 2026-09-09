import { chainSortIndex } from "@/app/constants";
import { mainnet } from "@/lib/chains";
import type { JBChainId, JBTokenContextData } from "@/lib/nana/types";
import { CashOutTaxRate, JB_CHAINS, ReservedPercent } from "@bananapus/nana-sdk-core";
import { twMerge } from "tailwind-merge";
import { Address, Chain, formatEther } from "viem";

export type ClassValue =
  string | number | boolean | null | undefined | ClassValue[] | { [className: string]: unknown };

function joinClassValues(value: ClassValue): string {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(joinClassValues).filter(Boolean).join(" ");
  return Object.entries(value)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([className]) => className)
    .join(" ");
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(inputs.map(joinClassValues).filter(Boolean).join(" "));
}

export function formatSeconds(seconds: number, precision = 2, compact = false) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ] as const;
  const firstUnit =
    safeSeconds > 31_536_000
      ? 0
      : safeSeconds > 2_592_000
        ? 1
        : safeSeconds > 86_400
          ? 2
          : safeSeconds > 3_600
            ? 3
            : 4;

  let remainder = safeSeconds;
  const values = units.map(([name, unitSeconds]) => {
    const value = Math.floor(remainder / unitSeconds);
    remainder %= unitSeconds;
    return { name, value };
  });
  const parts = values
    .slice(firstUnit, firstUnit + Math.max(1, precision))
    .map(({ name, value }) => `${value} ${name}${value === 1 ? "" : "s"}`);

  return parts.join(compact ? "" : ", ");
}

/**
 * The single source for block-explorer origins (e.g. "https://basescan.org").
 *
 * Hostnames come from the SDK's chain definitions. Returns undefined for chains
 * the SDK doesn't know, so callers fail closed instead of linking to
 * `https://undefined/...`.
 */
export function explorerBaseUrl(chainId: number): string | undefined {
  const chainMeta = JB_CHAINS[chainId as JBChainId];
  if (!chainMeta) return undefined;
  return `https://${chainMeta.etherscanHostname}`;
}

export function etherscanLink(
  addressOrTxHash: string,
  opts: {
    type: "address" | "tx" | "token";
    chain?: Chain;
    chainId?: number;
  },
) {
  const { type, chain = mainnet, chainId = chain.id } = opts;

  const baseUrl = explorerBaseUrl(chainId);
  if (!baseUrl) return undefined;

  switch (type) {
    case "address":
      return `${baseUrl}/address/${addressOrTxHash}`;
    case "tx":
      return `${baseUrl}/tx/${addressOrTxHash}`;
    case "token":
      return `${baseUrl}/token/${addressOrTxHash}`;
  }
}

export function formatEthAddress(
  address: string,
  opts: { truncateTo?: number } = { truncateTo: 4 },
) {
  if (!opts.truncateTo) return address;

  const frontTruncate = opts.truncateTo + 2; // account for 0x
  return (
    address.substring(0, frontTruncate) +
    "..." +
    address.substring(address.length - opts.truncateTo, address.length)
  );
}

/**
 * Return percentage of numerator / denominator (e.g. 69 for 69%)
 */
export function formatPortion(numerator: bigint, denominator: bigint) {
  if (numerator === 0n || denominator === 0n) return 0;
  return parseFloat(((numerator * 100000n) / denominator).toString()) / 1000;
}

/** Return a token ticker without a legacy leading dollar sign. */
export function formatTokenSymbol(token?: JBTokenContextData["token"] | string) {
  if (typeof token === "string") {
    if (!token) return "tokens";
    return token.replace(/^\$+/, "");
  }
  if (!token?.data?.symbol) return "TOKEN";
  return token.data.symbol.replace(/^\$+/, "");
}

/**
 * Hex formated wei from Relayr API to Ether
 */
export const formatHexEther = (hexWei: `0x${string}` | undefined, fixed = 8) => {
  if (!hexWei) return "0";
  return Number(formatEther(BigInt(hexWei))).toFixed(fixed);
};

export function sortChains(chainIds: JBChainId[]): JBChainId[] {
  return [...chainIds].sort((a, b) => {
    return chainSortIndex(a) - chainSortIndex(b);
  });
}

/**
 * Ruleset metadata
 * @see https://github.com/Bananapus/nana-core/blob/main/src/libraries/JBRulesetMetadataResolver.sol
 */
export type RulesetMetadata = {
  reservedPercent: ReservedPercent; // bits 4-19
  cashOutTaxRate: CashOutTaxRate; // bits 20-35
  baseCurrency: number; // bits 36-67
  pausePay: boolean; // bit 68
  pauseCreditTransfers: boolean; // bit 69
  allowOwnerMinting: boolean; // bit 70
  allowSetCustomToken: boolean; // bit 71
  allowTerminalMigration: boolean; // bit 72
  allowSetTerminals: boolean; // bit 73
  allowSetController: boolean; // bit 74
  allowAddAccountingContext: boolean; // bit 75
  allowAddPriceFeed: boolean; // bit 76
  ownerMustSendPayouts: boolean; // bit 77
  holdFees: boolean; // bit 78
  scopeCashOutsToLocalBalances: boolean; // bit 79 (true = cash outs use only the local chain's balance)
  useDataHookForPay: boolean; // bit 80
  useDataHookForCashOut: boolean; // bit 81
  dataHook: Address; // bits 82-241
  metadata: number; // bits 242-255
};

/**
 * Decodes packed ruleset metadata into its constituent parts
 * @param packed The packed uint256 metadata value
 * @returns Decoded metadata object
 * @see https://github.com/Bananapus/nana-core/blob/main/src/libraries/JBRulesetMetadataResolver.sol
 */
export function decodeRulesetMetadata(packed: bigint): RulesetMetadata {
  return {
    reservedPercent: new ReservedPercent(Number((packed >> 4n) & ((1n << 16n) - 1n))),
    cashOutTaxRate: new CashOutTaxRate(Number((packed >> 20n) & ((1n << 16n) - 1n))),
    baseCurrency: Number((packed >> 36n) & ((1n << 32n) - 1n)),

    // Boolean flags
    pausePay: Boolean((packed >> 68n) & 1n),
    pauseCreditTransfers: Boolean((packed >> 69n) & 1n),
    allowOwnerMinting: Boolean((packed >> 70n) & 1n),
    allowSetCustomToken: Boolean((packed >> 71n) & 1n),
    allowTerminalMigration: Boolean((packed >> 72n) & 1n),
    allowSetTerminals: Boolean((packed >> 73n) & 1n),
    allowSetController: Boolean((packed >> 74n) & 1n),
    allowAddAccountingContext: Boolean((packed >> 75n) & 1n),
    allowAddPriceFeed: Boolean((packed >> 76n) & 1n),
    ownerMustSendPayouts: Boolean((packed >> 77n) & 1n),
    holdFees: Boolean((packed >> 78n) & 1n),
    scopeCashOutsToLocalBalances: Boolean((packed >> 79n) & 1n),
    useDataHookForPay: Boolean((packed >> 80n) & 1n),
    useDataHookForCashOut: Boolean((packed >> 81n) & 1n),

    // Address
    dataHook:
      `0x${((packed >> 82n) & ((1n << 160n) - 1n)).toString(16).padStart(40, "0")}` as Address,

    // Final metadata (14 bits)
    metadata: Number((packed >> 242n) & ((1n << 14n) - 1n)),
  };
}

export function formatWalletError(error: unknown, defaultMessage = "Please try again") {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return defaultMessage;

  const { shortMessage, message } = error as Record<string, unknown>;
  if (typeof shortMessage === "string" && shortMessage) {
    return shortMessage.replace("User rejected", "You rejected");
  }
  if (typeof message === "string" && message) return message;
  return defaultMessage;
}
