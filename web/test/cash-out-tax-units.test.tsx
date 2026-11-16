import { explainCashOutChange } from "@/app/[slug]/components/TokenPrice/explainCashOutChange";
import { PriceChartTooltip } from "@/app/[slug]/components/TokenPrice/PriceChartTooltip";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cash out tax is a 0 to 1 value", () => {
  it("shows the on-chain rate (out of 10,000) as 0 to 1 in the chart tooltip", () => {
    render(
      <PriceChartTooltip
        datum={{ timestamp: 1, totalSupply: "1", totalBalance: "1", cashOutTaxRate: 1_000 }}
        series={[{ key: "floorPrice", label: "Cash out", color: "red", value: 5.36e-6 }] as never}
        baseTokenSymbol="ETH"
        baseTokenDecimals={18}
        range="3m"
      />,
    );
    expect(screen.getByText("0.1")).toBeInTheDocument();
    expect(screen.getByText("0.00000536 ETH")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("10.00%");
  });

  it("states tax changes as 0 to 1", () => {
    const base = { balance: 100n, tokenSupply: 100n, cashOutTax: 2_000, price: 1 };
    expect(explainCashOutChange(base, { ...base, cashOutTax: 3_000 })).toContain(
      "cash-out tax changed from 0.2 to 0.3",
    );
  });

  it("does not describe the tax as a percentage in guide or create copy", () => {
    const taxAsPercent = /\b\d+%[^.,\n"]{0,12}tax|tax\s+\d+%/iu;
    for (const file of ["src/app/learn/page.tsx", "src/app/build/page.tsx"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(taxAsPercent);
    }
    expect(readFileSync("src/app/create/form/AddStageDialog.tsx", "utf8")).not.toContain(
      "Cash-out tax percentage",
    );
  });
});
