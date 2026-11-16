import { chainDisplayName } from "@/app/constants";
import { formatPayAmount, type V6PayMode } from "@/lib/v6/pay";
import { PAY_QUOTE_FAILED_MESSAGE } from "@bananapus/nana-sdk-core/v6";

/** What a payment sends and gets, as its progress and its one review show it. */
export function payContext(
  prepared: {
    mode: V6PayMode;
    amount: bigint;
    token: { symbol: string; decimals: number };
    chainId: number;
    minReturned: bigint;
    quoteFailed: boolean;
    cartRows: { quantity: number; name: string }[];
    memo: string;
    account: string;
    projectNotice: string;
  },
  projectTokenSymbol: string,
): { label: string; value: string; strong?: boolean; note?: string }[] {
  return [
    {
      label: "Send",
      value: `${formatPayAmount(prepared.amount, prepared.token.decimals)} ${prepared.token.symbol}`,
      strong: true,
    },
    {
      label: "On",
      value: chainDisplayName(prepared.chainId),
    },
    prepared.mode === "pay"
      ? {
          label: "You get at least",
          value: `${formatPayAmount(prepared.minReturned, 18)} ${projectTokenSymbol}`,
          ...(prepared.quoteFailed ? { note: PAY_QUOTE_FAILED_MESSAGE } : {}),
        }
      : { label: "Effect", value: "Adds money to the project without giving you tokens." },
    ...(prepared.cartRows.length
      ? [
          {
            label: "Items",
            value: prepared.cartRows.map((row) => `${row.quantity}× ${row.name}`).join(", "),
          },
        ]
      : []),
    ...(prepared.mode === "pay" ? [{ label: "Beneficiary", value: prepared.account }] : []),
    ...(prepared.memo ? [{ label: "Note", value: prepared.memo }] : []),
    // What the project asks every payer to read before paying.
    ...(prepared.projectNotice
      ? [{ label: "Project notice", value: prepared.projectNotice, strong: true }]
      : []),
  ];
}
