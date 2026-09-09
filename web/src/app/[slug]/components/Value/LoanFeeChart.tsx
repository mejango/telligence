import { CartesianChart, type ChartSeries } from "@/components/ui/chart";

export function LoanFeeChart({
  prepaidPercent,
  setPrepaidPercent,
  feeData,
  grossBorrowedNative,
  collateralAmount,
  tokenSymbol,
  collateralTokenSymbol,
  displayYears,
  displayMonths,
}: {
  prepaidPercent: string;
  setPrepaidPercent: (v: string) => void;
  feeData: { year: number; totalCost: number }[];
  grossBorrowedNative: number;
  collateralAmount: string;
  tokenSymbol: string;
  collateralTokenSymbol?: string;
  displayYears: number;
  displayMonths: number;
}) {
  // Ensure feeData is valid and has reasonable values
  const validFeeData =
    feeData?.filter(
      (item) =>
        item &&
        typeof item.year === "number" &&
        Number.isFinite(item.year) &&
        typeof item.totalCost === "number" &&
        Number.isFinite(item.totalCost) &&
        item.totalCost >= 0 &&
        item.totalCost < Number.MAX_SAFE_INTEGER,
    ) || [];

  // Calculate the domain from the values that are safe to render.
  const maxCost =
    validFeeData.length > 0 ? Math.max(...validFeeData.map((datum) => datum.totalCost)) : 0;
  const minCost = grossBorrowedNative + grossBorrowedNative * 0.035; // borrowed amount + fixed fee
  const maxDomainCost = Math.max(maxCost * 1.1, minCost * 1.05, 1);
  const series: ChartSeries<(typeof validFeeData)[number]>[] = [
    {
      key: "totalCost",
      label: "Total paid to unlock",
      color: "#D98909",
      value: (datum) => datum.totalCost,
    },
  ];

  return (
    <div className="mt-2">
      <div className="mt-2 mb-2">
        <label className="block text-gray-700 text-sm font-bold mb-2">
          Prepaid Fee: {prepaidPercent}%
        </label>
        <input
          type="range"
          min="2.5"
          max="50"
          step="2.5"
          value={prepaidPercent}
          onChange={(e) => setPrepaidPercent(e.target.value)}
          aria-label="Prepaid fee percentage"
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Less upfront cost</span>
          <span>More upfront cost</span>
        </div>
      </div>
      <div className="h-64 min-h-[250px]">
        {validFeeData.length ? (
          <CartesianChart
            data={validFeeData}
            xValue={(datum) => datum.year}
            series={series}
            ariaLabel="Loan unlock cost over time"
            description={`The additional ${tokenSymbol} cost to unlock ${collateralAmount} ${
              collateralTokenSymbol || tokenSymbol
            } over ten years.`}
            className="h-full w-full"
            margin={{ top: 18, right: 18, bottom: 48, left: 48 }}
            xDomain={[0, 10]}
            yDomain={[minCost, maxDomainCost]}
            xTicks={[...Array(11).keys()]}
            showYTickLabels={false}
            formatXTick={(year) => `${year}`}
            xAxisLabel="Time (years)"
            yAxisLabel="Additional cost to unlock"
            grid="both"
            tooltip={({ datum }) => {
              if (datum.year >= 9.99) {
                return (
                  <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-xl">
                    <div className="font-medium">Final period – no collateral will be returned</div>
                    <div className="mt-1 text-zinc-600">No collateral can be reclaimed.</div>
                  </div>
                );
              }

              const months = Math.round(datum.year * 12);
              const years = Math.floor(months / 12);
              const remMonths = months % 12;
              const collateralSymbol = collateralTokenSymbol || tokenSymbol;
              return (
                <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-xl whitespace-nowrap">
                  <div className="font-medium">
                    {months} months ({years}y {remMonths}m)
                  </div>
                  <div className="mt-1 text-zinc-700">
                    Total paid to unlock: {datum.totalCost.toFixed(8)} {tokenSymbol}
                  </div>
                  <div className="text-zinc-600">
                    Collateral returned: {collateralAmount} {collateralSymbol}
                  </div>
                </div>
              );
            }}
          />
        ) : (
          <div
            className="flex h-full items-center justify-center text-sm text-zinc-500"
            role="status"
          >
            No loan fee data available
          </div>
        )}
      </div>
      <p className="text-sm text-gray-600 mt-3 text-center">
        Fees increase after{" "}
        {displayYears > 0
          ? `${displayYears} year${displayYears > 1 ? "s" : ""}${displayMonths > 0 ? ` and ${displayMonths} month${displayMonths > 1 ? "s" : ""}` : ""}`
          : `${displayMonths} month${displayMonths > 1 ? "s" : ""}`}
      </p>
    </div>
  );
}
