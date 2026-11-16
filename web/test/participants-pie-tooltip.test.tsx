import { ParticipantsPieChart } from "@/app/[slug]/owners/components/ParticipantsPieChart";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: vi.fn() }));

describe("owner donut tooltip", () => {
  it("prints a rounded balance in the project's symbol", () => {
    const { container } = render(
      <ParticipantsPieChart
        participants={[
          { address: "0xa", balance: 188065803658701046929306n, chains: [1] },
          { address: "0xb", balance: 1003934196341298953070694n, chains: [1] },
        ]}
        totalSupply={1192000000000000000000000n}
        token={{ symbol: "REV", decimals: 18 } as never}
      />,
    );
    fireEvent.mouseEnter(container.querySelectorAll("path")[1]!);
    expect(screen.getByText(/188,065\.8\s+REV\s+\(15\.777%\)/u)).toBeInTheDocument();
  });
});
