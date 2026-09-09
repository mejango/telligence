import { formatProjectPreviewBalance, projectPreviewSlogan } from "@/lib/project-link-preview";
import { describe, expect, it } from "vitest";

describe("project link preview balance", () => {
  it("adds matching balances across chains", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "1250000", decimals: 6, tokenSymbol: "USDC" },
        { balance: "2750000", decimals: 6, tokenSymbol: "USDC" },
      ]),
    ).toBe("4.00 USDC");
  });

  it("keeps unlike accounting tokens separate", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "1500000000000000000", decimals: 18, tokenSymbol: "ETH" },
        { balance: "2500000", decimals: 6, tokenSymbol: "USDC" },
      ]),
    ).toBe("1.5 ETH + 2.50 USDC");
  });

  it("renders unknown rather than treating malformed rows as zero", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "bad", decimals: 18, tokenSymbol: "ETH" },
        { balance: "12", decimals: null, tokenSymbol: "USDC" },
      ]),
    ).toBe("Unavailable");
  });

  it("uses a plain-text description when there is no dedicated tagline", () => {
    expect(projectPreviewSlogan(null, "<p>Join our <b>creative</b> mission.</p>")).toBe(
      "Join our creative mission.",
    );
  });
});
