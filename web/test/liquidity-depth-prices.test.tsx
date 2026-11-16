import { LiquidityVisualization } from "@/app/[slug]/components/v6/owners/market/AmmCard";
import type { PoolComposition, PoolSnapshot } from "@/app/[slug]/components/v6/owners/market/lib";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const pool = {
  price: 1,
  sqrtP: 2n ** 96n,
  pairIsC0: false,
  pair: { decimals: 18, symbol: "USDC" },
} as PoolSnapshot;
const composition: PoolComposition = {
  pairAmount: 10n ** 18n,
  tokenAmount: 10n ** 18n,
  ranges: [{ tickLower: -100, tickUpper: 100, liquidity: 10n ** 18n }],
};

function markers(container: HTMLElement) {
  return [...container.querySelectorAll("line")];
}

describe("liquidity depth reference prices", () => {
  it.each([false, true])(
    "keeps narrow LP ranges visible between wider references with pairIsC0=%s",
    (pairIsC0) => {
      const { container } = render(
        <LiquidityVisualization
          pool={{ ...pool, pairIsC0 }}
          composition={composition}
          tokenSymbol="ART"
          reference={{ cashOut: 0.5, issuance: 2 }}
        />,
      );
      // Neither of the two center band midpoints lies inside ticks -100..100.
      // Both partial intersections must still contribute visible depth.
      const bars = [...container.querySelectorAll("svg rect")];
      expect(bars).toHaveLength(2);
      expect(bars.map((bar) => Number(bar.getAttribute("x")))).toEqual([153.3, 160]);
      const heights = bars.map((bar) => Number(bar.getAttribute("height")));
      expect(heights[0]).toBeGreaterThan(0);
      expect(heights[0]).toBeCloseTo(heights[1], 1);
      expect(markers(container).map((line) => Number(line.getAttribute("x1")))).toEqual([
        160, 0, 320,
      ]);
    },
  );

  it("includes references beyond LP ranges and places all prices on the same logarithmic axis", () => {
    const { container } = render(
      <LiquidityVisualization
        pool={pool}
        composition={composition}
        tokenSymbol="ART"
        reference={{ cashOut: 0.5, issuance: 2 }}
      />,
    );
    expect(
      screen.getByText("Cash out price: 0.5 USDC/ART", { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Issuance price: 2 USDC/ART", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pool price: 1 USDC/ART", { selector: "span" })).toBeInTheDocument();
    expect(markers(container).map((line) => Number(line.getAttribute("x1")))).toEqual([
      160, 0, 320,
    ]);
    expect(screen.queryByText(/^(floor|ceiling)$/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll("svg text")).toHaveLength(0);
    expect(screen.getByText(/Band near/)).toBeInTheDocument();
  });

  it("keeps close price labels in the legend instead of overlapping them inside the plot", () => {
    const { container } = render(
      <LiquidityVisualization
        pool={pool}
        composition={composition}
        tokenSymbol="ART"
        reference={{ cashOut: 1.0001, issuance: 1.0002 }}
      />,
    );
    expect(markers(container)).toHaveLength(3);
    expect(markers(container).map((line) => line.getAttribute("stroke"))).toEqual([
      "#f59e0b",
      "#6366f1",
      "#65a578",
    ]);
    expect(container.querySelectorAll("svg text")).toHaveLength(0);
  });

  it.each([null, 0, -1, NaN, Infinity])(
    "omits unavailable or unplottable reference %s",
    (value) => {
      const { container } = render(
        <LiquidityVisualization
          pool={pool}
          composition={composition}
          tokenSymbol="ART"
          reference={{ cashOut: value, issuance: value }}
        />,
      );
      expect(markers(container)).toHaveLength(1);
      expect(Number(markers(container)[0].getAttribute("x1"))).toBeCloseTo(160);
      expect(screen.queryByText(/Cash out price:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Issuance price:/)).not.toBeInTheDocument();
    },
  );
});
