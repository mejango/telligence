import { LoanFeeChart } from "@/app/[slug]/components/Value/LoanFeeChart";
import {
  CartesianChart,
  chartTicks,
  findNearestIndex,
  linePath,
  linearScale,
  type ChartSeries,
} from "@/components/ui/chart";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("SVG chart geometry", () => {
  it("maps domains, selects nearest observations, and builds finite paths", () => {
    expect(linearScale(5, 0, 10, 20, 120)).toBe(70);
    expect(chartTicks(0, 10, 3)).toEqual([0, 5, 10]);
    expect(findNearestIndex([{ x: 0 }, { x: 4 }, { x: 9 }], (datum) => datum.x, 6)).toBe(1);

    const path = linePath(
      [
        { x: 0, y: 8 },
        { x: 5, y: 4 },
        { x: 10, y: 2 },
      ],
      "monotone",
    );
    expect(path).toMatch(/^M 0 8 C /);
    expect(path).not.toContain("NaN");
    expect(path).not.toContain("Infinity");
  });

  it("keeps monotone curves inside every adjacent observation range", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 100 },
    ];
    const path = linePath(points, "monotone");
    const curves = [...path.matchAll(/C ([^C]+)/g)];
    expect(curves).toHaveLength(points.length - 1);

    curves.forEach((curve, index) => {
      const values = curve[1].match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number);
      expect(values).toHaveLength(6);
      const [, firstControlY, , secondControlY, , endY] = values!;
      const startY = points[index].y;
      const expectedEndY = points[index + 1].y;
      const lower = Math.min(startY, expectedEndY);
      const upper = Math.max(startY, expectedEndY);

      // A cubic Bezier stays inside the convex hull of its four control values.
      expect(firstControlY).toBeGreaterThanOrEqual(lower);
      expect(firstControlY).toBeLessThanOrEqual(upper);
      expect(secondControlY).toBeGreaterThanOrEqual(lower);
      expect(secondControlY).toBeLessThanOrEqual(upper);
      expect(endY).toBe(expectedEndY);
    });
  });

  it("supports keyboard inspection without requiring pointer precision", () => {
    const data = [
      { timestamp: 10, price: 1 },
      { timestamp: 20, price: 2 },
      { timestamp: 30, price: 3 },
    ];
    const series: ChartSeries<(typeof data)[number]>[] = [
      {
        key: "price",
        label: "Price",
        color: "#123456",
        value: (datum) => datum.price,
      },
    ];

    render(
      <CartesianChart
        data={data}
        xValue={(datum) => datum.timestamp}
        series={series}
        ariaLabel="Test price history"
        description="A deterministic price series."
        className="h-64"
        tooltip={({ datum }) => <div>Point {datum.timestamp}</div>}
      />,
    );

    const chart = screen.getByRole("group", { name: "Test price history" });
    fireEvent.focus(chart);
    expect(screen.getByText("Point 30")).toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByText("Point 20")).toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByText("Point 10")).toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByText("Point 30")).toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByText("Point 30")).not.toBeInTheDocument();
  });

  it("reports pointer-selected data and clears it on pointer leave", () => {
    const data = [
      { timestamp: 0, price: 1 },
      { timestamp: 50, price: 2 },
      { timestamp: 100, price: 3 },
    ];
    const onActiveIndexChange = vi.fn();

    render(
      <CartesianChart
        data={data}
        xValue={(datum) => datum.timestamp}
        series={[
          {
            key: "price",
            label: "Price",
            color: "#123456",
            value: (datum) => datum.price,
          },
        ]}
        ariaLabel="Pointer chart"
        description="A pointer-test series."
        className="h-64"
        onActiveIndexChange={onActiveIndexChange}
        tooltip={({ datum }) => <div>Pointer {datum.timestamp}</div>}
      />,
    );

    const chart = screen.getByRole("group", { name: "Pointer chart" });
    expect(chart.className).toContain("touch-pan-y");
    expect(chart.className).not.toContain("touch-none");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 320,
      top: 0,
      right: 800,
      bottom: 320,
      left: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerMove(chart, { clientX: 400 });
    expect(screen.getByText("Pointer 50")).toBeInTheDocument();
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(1);

    fireEvent.pointerLeave(chart);
    expect(screen.queryByText("Pointer 50")).not.toBeInTheDocument();
  });

  it("keeps a controlled null inspection closed", () => {
    const data = [
      { timestamp: 0, price: 1 },
      { timestamp: 100, price: 3 },
    ];
    const { rerender } = render(
      <CartesianChart
        data={data}
        xValue={(datum) => datum.timestamp}
        series={[
          {
            key: "price",
            label: "Price",
            color: "#123456",
            value: (datum) => datum.price,
          },
        ]}
        ariaLabel="Controlled chart"
        description="A controlled inspection series."
        tooltip={({ datum }) => <div>Controlled {datum.timestamp}</div>}
      />,
    );

    const chart = screen.getByRole("group", { name: "Controlled chart" });
    fireEvent.focus(chart);
    expect(screen.getByText("Controlled 100")).toBeInTheDocument();

    rerender(
      <CartesianChart
        data={data}
        xValue={(datum) => datum.timestamp}
        series={[
          {
            key: "price",
            label: "Price",
            color: "#123456",
            value: (datum) => datum.price,
          },
        ]}
        ariaLabel="Controlled chart"
        description="A controlled inspection series."
        activeIndex={null}
        tooltip={({ datum }) => <div>Controlled {datum.timestamp}</div>}
      />,
    );

    expect(screen.queryByText("Controlled 100")).not.toBeInTheDocument();
  });
});

describe("LoanFeeChart", () => {
  const baseProps = {
    prepaidPercent: "10",
    setPrepaidPercent: vi.fn(),
    nativeToWallet: 1,
    grossBorrowedNative: 1,
    collateralAmount: "100",
    tokenSymbol: "ETH",
    collateralTokenSymbol: "REV",
    displayYears: 1,
    displayMonths: 6,
  };

  it("preserves the final-period and ordinary fee inspection copy", () => {
    render(
      <LoanFeeChart
        {...baseProps}
        feeData={[
          { year: 1, totalCost: 1.2 },
          { year: 10, totalCost: 4.5 },
        ]}
      />,
    );

    const chart = screen.getByRole("group", { name: "Loan unlock cost over time" });
    fireEvent.focus(chart);
    expect(screen.getByText("Final period – no collateral will be returned")).toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByText("12 months (1y 0m)")).toBeInTheDocument();
    expect(screen.getByText("Total paid to unlock: 1.20000000 ETH")).toBeInTheDocument();
    expect(screen.getByText("Collateral returned: 100 REV")).toBeInTheDocument();
  });

  it("renders a stable empty state when all observations are unsafe", () => {
    render(
      <LoanFeeChart
        {...baseProps}
        feeData={[
          { year: Number.NaN, totalCost: 1 },
          { year: 1, totalCost: Number.POSITIVE_INFINITY },
        ]}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("No loan fee data available");
  });
});
