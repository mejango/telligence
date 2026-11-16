import { PayerAddressList } from "@/app/[slug]/components/v6/extras/PayerAddressList";
import type { PayerRow } from "@/app/[slug]/components/v6/extras/projectPayers";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/components/EthereumAddress", () => ({ EthereumAddress: () => <a>short</a> }));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));

it("copies a payer's full address from its row", () => {
  const writeText = vi.fn(async () => undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  const address = "0x61cc00000000000000000000000000000000feb1";
  render(
    <PayerAddressList
      rows={[{ chainId: 8453, address, totalFacilitated: "0" } as unknown as PayerRow]}
      isLoading={false}
      isError={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith(address);
});
