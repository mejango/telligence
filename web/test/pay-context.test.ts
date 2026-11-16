import { payContext } from "@/app/[slug]/components/v6/pay/payContext";
import { describe, expect, it } from "vitest";

const prepared = {
  mode: "pay" as const,
  amount: 1_000_000n,
  token: { symbol: "USDC", decimals: 6 },
  chainId: 8453,
  minReturned: 5n * 10n ** 18n,
  quoteFailed: false,
  cartRows: [],
  memo: "",
  account: "0x1111111111111111111111111111111111111111",
  projectNotice: "No refunds.",
};

describe("payContext", () => {
  it("names who gets the tokens and shows the project's payment notice", () => {
    const rows = payContext(prepared, "TKN");
    expect(rows).toContainEqual({ label: "Beneficiary", value: prepared.account });
    expect(rows.at(-1)).toEqual({ label: "Project notice", value: "No refunds.", strong: true });
  });

  it("leaves both out when there is no notice and no tokens are issued", () => {
    const labels = payContext(
      { ...prepared, mode: "addbalance" as const, projectNotice: "" },
      "TKN",
    ).map((row) => row.label);
    expect(labels).not.toContain("Beneficiary");
    expect(labels).not.toContain("Project notice");
  });
});
