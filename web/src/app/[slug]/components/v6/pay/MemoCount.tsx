import { MEMO_MAX_LENGTH } from "@/lib/v6/pay";

const COUNT_SHOWN_ABOVE = 200;

/** A note's length against its limit, once it nears the limit. */
export function MemoCount({ length, className }: { length: number; className?: string }) {
  if (length <= COUNT_SHOWN_ABOVE) return null;
  return (
    <span className={`text-xs tabular-nums text-zinc-500 ${className ?? ""}`}>
      {length}/{MEMO_MAX_LENGTH}
    </span>
  );
}
