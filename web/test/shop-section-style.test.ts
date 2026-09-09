import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inventory = readFileSync("src/app/[slug]/components/v6/shop/InventorySection.tsx", "utf8");
const customers = readFileSync("src/app/[slug]/components/v6/shop/CustomersSection.tsx", "utf8");

describe("shop section surfaces", () => {
  it("uses the same filled section color as the rest of the project view", () => {
    expect(inventory.match(/className="bg-melon-50 p-5"/g)).toHaveLength(2);
    expect(inventory).toContain('className="group bg-melon-50 px-5 py-4"');
    expect(customers.match(/className="bg-melon-50 p-5"/g)).toHaveLength(3);
    expect(inventory).not.toContain("border border-melon-200 bg-white p-5");
    expect(customers).not.toContain("border border-melon-200 bg-white p-5");
  });
});
