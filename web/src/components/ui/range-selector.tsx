"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type RangeOption<T extends string> = {
  value: T;
  label: string;
};

interface Props<T extends string> {
  ranges: RangeOption<T>[];
  defaultValue: T;
}

/**
 * A quiet range picker in the same voice as MarketPriceViewToggle: a naked
 * select with a chevron, taking one text line instead of a row of pills.
 * The range stays URL state (?range=) so links and reloads keep it.
 */
export function RangeSelector<T extends string>({ ranges, defaultValue }: Props<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rangeParam = searchParams.get("range");

  const validValues = ranges.map((r) => r.value);
  const currentValue = validValues.includes(rangeParam as T) ? (rangeParam as T) : defaultValue;

  return (
    <div className="relative inline-flex shrink-0 items-center text-teal-700">
      <select
        value={currentValue}
        onChange={(event) =>
          router.push(`${pathname}?range=${event.target.value}`, { scroll: false })
        }
        aria-label="Time range"
        className="cursor-pointer appearance-none border-0 bg-none bg-transparent p-0 pr-4 text-xs font-medium text-current [field-sizing:content] hover:underline focus:border-0 focus:ring-0 focus-visible:!outline-none focus-visible:underline"
      >
        {ranges.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="pointer-events-none absolute right-0 h-3 w-3"
      >
        <path
          d="m2.5 4.25 3.5 3.5 3.5-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
