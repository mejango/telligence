import { legacyIntents } from "@/lib/legacy-intents";
import { buildProtectedBorrowTx } from "@/lib/loanTransactions";
import {
  approvalIntent,
  borrowIntent,
  cashOutIntent,
  payIntent,
} from "@bananapus/nana-sdk-core/review";
import { buildCashOutTx, buildPayTx } from "@bananapus/nana-sdk-core/v6";
import { erc20Abi, type Abi, type Address } from "viem";

type WriteRequest = {
  chainId: number;
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

const HOLDER = "0x1111111111111111111111111111111111111111" as const;
const TERMINAL = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const NATIVE = "0x000000000000000000000000000000000000EEEe" as const;

/** The writes the reviewed-call baseline covers: a payment with its approval, a cash out and a loan. */
export function baselineRequests(): {
  name: string;
  request: WriteRequest;
  intent?: string;
  legacy: readonly string[];
}[] {
  const pay = payIntent({ chainId: 8453, project: 7n, beneficiary: HOLDER });
  return [
    {
      name: "approve",
      request: {
        chainId: 8453,
        address: TOKEN,
        abi: erc20Abi,
        functionName: "approve",
        args: [TERMINAL, 5_000_000n],
      },
      intent: approvalIntent(pay, { step: "erc20", token: TOKEN, spender: TERMINAL }),
      legacy: [],
    },
    {
      name: "pay",
      request: buildPayTx({
        chainId: 8453,
        terminal: TERMINAL,
        projectId: 7n,
        token: NATIVE,
        amount: 10n ** 16n,
        beneficiary: HOLDER,
        minReturnedTokens: 1n,
        memo: "",
        metadata: "0x",
      }) as WriteRequest,
      intent: pay,
      legacy: legacyIntents.pay(7n, HOLDER),
    },
    {
      name: "cashOut",
      request: buildCashOutTx({
        chainId: 8453,
        terminal: TERMINAL,
        holder: HOLDER,
        projectId: 7n,
        cashOutCount: 10n ** 18n,
        tokenToReclaim: NATIVE,
        minTokensReclaimed: 1n,
        beneficiary: HOLDER,
        metadata: "0x",
      }) as WriteRequest,
      intent: cashOutIntent({ chainId: 8453, project: 7n, holder: HOLDER, beneficiary: HOLDER }),
      legacy: legacyIntents.cashOut({
        projectId: 7n,
        token: NATIVE,
        amount: 10n ** 18n,
        beneficiary: HOLDER,
      }),
    },
    {
      name: "borrow",
      request: buildProtectedBorrowTx({
        chainId: 8453,
        revnetId: 7n,
        token: NATIVE,
        quotedBorrowAmount: 10n ** 15n,
        collateralCount: 10n ** 18n,
        beneficiary: HOLDER,
        prepaidFeePercent: 25n,
        holder: HOLDER,
      }) as WriteRequest,
      intent: borrowIntent({ chainId: 8453, project: 7n, holder: HOLDER }),
      legacy: legacyIntents.borrow({
        revnetId: 7n,
        token: NATIVE,
        collateral: 10n ** 18n,
        prepaidFeePercent: 25,
      }),
    },
  ];
}
