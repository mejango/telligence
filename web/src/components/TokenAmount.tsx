import { compactTokenAmount } from "@/lib/number";

export function TokenAmount({
  value,
  decimals,
  symbol,
}: {
  value: bigint;
  decimals: number;
  symbol?: string;
}) {
  const { text, title } = compactTokenAmount(value, decimals, symbol);
  return <span title={title}>{text}</span>;
}
