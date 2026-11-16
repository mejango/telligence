import { defaultStageData } from "@/app/create/constants";
import { expect, it } from "vitest";

// The same starting stage as juicebox.money's revnet form: no issuance cut, cash out tax 0.1.
it("starts a stage with no cut and a 0.1 cash out tax", () => {
  expect(defaultStageData).toMatchObject({
    priceCeilingIncreasePercentage: "0",
    priceCeilingIncreaseFrequency: "0",
    priceFloorTaxIntensity: "10",
  });
});
