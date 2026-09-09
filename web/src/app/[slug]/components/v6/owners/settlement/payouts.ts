import type { RawRuleset } from "@/lib/nana/rulesets";
import type { ExpectedPayoutReceipt } from "@/lib/payout-receipts";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  jbContractAddress,
  jbControllerAbi,
  JBCoreContracts,
  jbDirectoryAbi,
  jbFundAccessLimitsAbi,
  jbMultiTerminalAbi,
  jbPricesAbi,
  jbProjectsAbi,
  jbRulesetsAbi,
  jbSplitsAbi,
  jbTerminalStoreAbi,
} from "@bananapus/nana-sdk-core";
import {
  type Abi,
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  isAddress,
  keccak256,
  parseUnits,
  type PublicClient,
  toEventSelector,
  toHex,
  zeroAddress,
} from "viem";
import { type ChainProject, tokenSymbolOf } from "./lib";

type PayoutPrecondition = { address: Address; data: Hex; expected: Hex };
type PayoutSplit = {
  percent: number;
  projectId: bigint;
  beneficiary: Address;
  preferAddToBalance: boolean;
  lockedUntil: number;
  hook: Address;
};
type AccountingContext = { token: Address; decimals: number; currency: number };

export type PayoutOption = ChainProject & {
  key: string;
  terminal: Address;
  token: Address;
  symbol: string;
  decimals: number;
  currency: number;
  accountingCurrency: number;
  rulesetId: number;
  cycleNumber: number;
  owner: Address;
  splits: readonly PayoutSplit[];
  remainingLimit: bigint;
  availableAmount: bigint;
  balance: bigint;
  /** Token units = floor(limit-currency units * 1e18 / price). */
  price: bigint;
  preconditions: PayoutPrecondition[];
  sourceKey: Hex;
};

const PRICE_SCALE = 10n ** 18n;
const TOTAL_SPLIT_PERCENT = 1_000_000_000;

function requiredAddress(address: Address, label: string): Address {
  if (!isAddress(address) || address === zeroAddress) throw new Error(`${label} is unavailable.`);
  return address;
}

/** Read every option at one block; every reviewed source read becomes a durable guard. */
export async function readPayoutOptions(
  client: Pick<PublicClient, "call" | "getBlockNumber">,
  project: ChainProject,
  symbolOf: typeof tokenSymbolOf = tokenSymbolOf,
): Promise<PayoutOption[]> {
  const { chainId, projectId } = project;
  const blockNumber = await client.getBlockNumber();
  const rootGuards: PayoutPrecondition[] = [];
  const read = async <T>(
    guards: PayoutPrecondition[],
    address: Address,
    abi: Abi,
    functionName: string,
    args?: readonly unknown[],
  ): Promise<T> => {
    const data = encodeFunctionData({ abi, functionName, args });
    const { data: expected } = await client.call({ to: address, data, blockNumber });
    if (!expected || expected === "0x") throw new Error(`Could not verify ${functionName}.`);
    guards.push({ address, data, expected });
    return decodeFunctionResult({ abi, functionName, data: expected }) as T;
  };
  const directory = requiredAddress(
    jbContractAddress[6][JBCoreContracts.JBDirectory][chainId] as Address,
    "Project directory",
  );
  const controller = requiredAddress(
    await read<Address>(rootGuards, directory, jbDirectoryAbi, "controllerOf", [projectId]),
    "Current controller",
  );
  const terminals = await read<readonly Address[]>(
    rootGuards,
    directory,
    jbDirectoryAbi,
    "terminalsOf",
    [projectId],
  );
  const limits = requiredAddress(
    await read<Address>(rootGuards, controller, jbControllerAbi, "FUND_ACCESS_LIMITS"),
    "Payout limits",
  );
  const options: PayoutOption[] = [];
  for (const terminal of terminals) {
    const terminalGuards = [...rootGuards];
    const contexts = await read<readonly AccountingContext[]>(
      terminalGuards,
      terminal,
      jbMultiTerminalAbi,
      "accountingContextsOf",
      [projectId],
    );
    if (!contexts.length) continue;
    const store = requiredAddress(
      await read<Address>(terminalGuards, terminal, jbMultiTerminalAbi, "STORE"),
      "Terminal store",
    );
    const splitsAddress = requiredAddress(
      await read<Address>(terminalGuards, terminal, jbMultiTerminalAbi, "SPLITS"),
      "Payout splits",
    );
    const projectsAddress = requiredAddress(
      await read<Address>(terminalGuards, terminal, jbMultiTerminalAbi, "PROJECTS"),
      "Project owners",
    );
    const owner = await read<Address>(terminalGuards, projectsAddress, jbProjectsAbi, "ownerOf", [
      projectId,
    ]);
    const rulesets = requiredAddress(
      await read<Address>(terminalGuards, store, jbTerminalStoreAbi, "RULESETS"),
      "Rulesets",
    );
    const ruleset = await read<RawRuleset>(terminalGuards, rulesets, jbRulesetsAbi, "currentOf", [
      projectId,
    ]);
    for (const context of contexts) {
      const contextGuards = [...terminalGuards];
      const { token, decimals, currency: accountingCurrency } = context;
      const balance = await read<bigint>(contextGuards, store, jbTerminalStoreAbi, "balanceOf", [
        terminal,
        projectId,
        token,
      ]);
      const payoutLimits = await read<readonly { amount: bigint; currency: number }[]>(
        contextGuards,
        limits,
        jbFundAccessLimitsAbi,
        "payoutLimitsOf",
        [projectId, BigInt(ruleset.id), terminal, token],
      );
      const splits = await read<readonly PayoutSplit[]>(
        contextGuards,
        splitsAddress,
        jbSplitsAbi,
        "splitsOf",
        [projectId, BigInt(ruleset.id), BigInt(token)],
      );
      const symbol = await symbolOf(chainId, token);
      for (const limit of payoutLimits) {
        const preconditions = [...contextGuards];
        const used = await read<bigint>(
          preconditions,
          store,
          jbTerminalStoreAbi,
          "usedPayoutLimitOf",
          [terminal, projectId, token, BigInt(ruleset.cycleNumber), BigInt(limit.currency)],
        );
        const remainingLimit = limit.amount > used ? limit.amount - used : 0n;
        let price = PRICE_SCALE;
        if (limit.currency !== accountingCurrency) {
          const prices = requiredAddress(
            await read<Address>(preconditions, store, jbTerminalStoreAbi, "PRICES"),
            "Currency prices",
          );
          price = await read<bigint>(preconditions, prices, jbPricesAbi, "pricePerUnitOf", [
            projectId,
            BigInt(limit.currency),
            BigInt(accountingCurrency),
            18n,
          ]);
          if (price <= 0n) throw new Error("The payout currency price is unavailable.");
        }
        // Round the balance-limited maximum down, so the terminal conversion
        // cannot request more tokens than the verified balance can supply.
        const balanceInLimitCurrency = (balance * price) / PRICE_SCALE;
        const availableAmount =
          remainingLimit < balanceInLimitCurrency ? remainingLimit : balanceInLimitCurrency;
        options.push({
          ...project,
          key: `${chainId}:${projectId}:${terminal.toLowerCase()}:${token.toLowerCase()}:${limit.currency}`,
          terminal,
          token,
          symbol,
          decimals,
          currency: limit.currency,
          accountingCurrency,
          rulesetId: ruleset.id,
          cycleNumber: ruleset.cycleNumber,
          owner,
          splits,
          balance,
          remainingLimit,
          availableAmount,
          price,
          preconditions,
          sourceKey: keccak256(toHex(JSON.stringify(preconditions))),
        });
      }
    }
  }
  return options;
}

export async function fetchPayoutOptions(chains: readonly ChainProject[]) {
  return Promise.all(
    chains.map(async (project) => {
      try {
        const options = await readPayoutOptions(getViemPublicClient(project.chainId), project);
        return { ...project, options, error: null };
      } catch (error) {
        return {
          ...project,
          options: [],
          error: error instanceof Error ? error.message : "Could not verify payouts.",
        };
      }
    }),
  );
}

export function payoutCurrencyLabel(option: PayoutOption): string {
  if (option.currency === option.accountingCurrency) return option.symbol;
  return option.currency === 1
    ? "ETH"
    : option.currency === 2
      ? "USD"
      : `currency ${option.currency}`;
}

/** Strict decimal parsing: viem parseUnits rounds excess decimal places. */
export function payoutAmount(value: string, decimals: number): bigint {
  const input = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(input) || (input.split(".")[1]?.length ?? 0) > decimals) {
    throw new Error(`Enter an amount with at most ${decimals} decimal places.`);
  }
  const amount = parseUnits(input, decimals);
  if (amount <= 0n) throw new Error("Payout amounts and minimums must be greater than zero.");
  return amount;
}

export function payoutTokenAmount(option: PayoutOption, amount: bigint): bigint {
  return (amount * PRICE_SCALE) / option.price;
}

export function payoutRecipients(option: PayoutOption, account: Address): string[] {
  const recipients = option.splits.map((split) => {
    const destination =
      split.hook !== zeroAddress
        ? `hook ${split.hook}`
        : split.projectId !== 0n
          ? `project #${split.projectId} (${split.preferAddToBalance ? "add to balance" : "pay"}; tokens to ${split.beneficiary === zeroAddress ? account : split.beneficiary})`
          : split.beneficiary === zeroAddress
            ? `caller ${account}`
            : split.beneficiary;
    return `${split.percent / 10_000_000}% to ${destination}`;
  });
  const remainder =
    TOTAL_SPLIT_PERCENT - option.splits.reduce((total, split) => total + split.percent, 0);
  if (remainder > 0) recipients.push(`${remainder / 10_000_000}% to project owner ${option.owner}`);
  return recipients;
}

export function buildPayoutCall(
  option: PayoutOption,
  amountInput: string,
  minimumInput: string,
  account: Address,
) {
  const amount = payoutAmount(amountInput, option.decimals);
  const minTokensPaidOut = payoutAmount(minimumInput, option.decimals);
  if (amount > option.availableAmount)
    throw new Error(
      "The payout exceeds the remaining limit or terminal balance. Refresh and review again.",
    );
  if (minTokensPaidOut > payoutTokenAmount(option, amount))
    throw new Error("The minimum exceeds the expected payout in terminal tokens.");
  const expectedPayout: ExpectedPayoutReceipt = {
    kind: "payout",
    terminal: option.terminal,
    projectId: String(option.projectId),
    rulesetId: String(option.rulesetId),
    cycleNumber: String(option.cycleNumber),
    token: option.token,
    owner: option.owner,
    caller: account,
    amount: String(amount),
    minimum: String(minTokensPaidOut),
    splits: option.splits.map((split) => ({ ...split, projectId: String(split.projectId) })),
  };
  return {
    chainId: option.chainId,
    address: option.terminal,
    abi: jbMultiTerminalAbi,
    functionName: "sendPayoutsOf" as const,
    args: [
      option.projectId,
      option.token,
      amount,
      BigInt(option.currency),
      minTokensPaidOut,
    ] as const,
    contractName: "JBMultiTerminal",
    relayrMode: "forwarded" as const,
    recoveryScope: `payout:${option.chainId}:${option.projectId}:${option.terminal.toLowerCase()}:${option.token.toLowerCase()}`,
    preconditions: option.preconditions,
    expectedPayout,
    rejectEvents: [
      {
        address: option.terminal,
        topic: toEventSelector(
          "PayoutReverted(uint256,(uint32,uint64,address,bool,uint48,address),uint256,bytes,address)",
        ),
      },
      {
        address: option.terminal,
        topic: toEventSelector(
          "PayoutTransferReverted(uint256,address,address,uint256,uint256,bytes,address)",
        ),
      },
    ],
  };
}
