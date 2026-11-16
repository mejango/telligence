import { TokenPriceChart } from "@/app/[slug]/components/TokenPrice/TokenPriceChart";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ range: "3m", read: vi.fn() }));
vi.mock("@/app/[slug]/components/TokenPrice/getTokenPriceChartData", () => ({
  getTokenPriceChartData: mocks.read,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ range: mocks.range }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBTokenContext: () => ({ token: { data: { symbol: "REV" } } }),
}));
vi.mock("@/components/ui/range-selector", () => ({ RangeSelector: () => null }));
vi.mock("@/components/ui/chart", () => ({
  CartesianChart: ({
    data,
    ariaLabel,
  }: {
    data: { issuancePrice: number }[];
    ariaLabel: string;
  }) => (
    <div role="img" aria-label={ariaLabel}>
      price {data[0].issuancePrice}
    </div>
  ),
}));

const props: ComponentProps<typeof TokenPriceChart> = {
  projectId: "7",
  chainId: 10,
  suckerGroupId: "group",
  token: "0xeeee",
  tokenSymbol: "ETH",
  tokenDecimals: 18,
};
const history = (price: number) => ({
  chartData: [{ timestamp: 100, issuancePrice: price }],
  tradeChartData: [],
  hasPool: false,
  poolReserves: [],
  baseCurrency: 1,
  conversionBasis: null,
  marketSeriesUnavailable: false,
  unavailableSources: [],
  stages: [],
});
function view(client: QueryClient, value = props) {
  return (
    <QueryClientProvider client={client}>
      <TokenPriceChart {...value} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.range = "3m";
  mocks.read.mockResolvedValue(history(9));
});

describe("project chart query reuse", () => {
  it("reuses a recent range and keeps only the same identity's prior range while loading", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(view(client));
    expect(await screen.findByText("price 9")).toBeInTheDocument();
    let finish!: (value: ReturnType<typeof history>) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mocks.range = "1h";
    rendered.rerender(view(client));
    expect(screen.getByText("price 9")).toBeInTheDocument();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    await act(async () => finish(history(4)));
    expect(await screen.findByText("price 4")).toBeInTheDocument();
    mocks.range = "3m";
    rendered.rerender(view(client));
    expect(screen.getByText("price 9")).toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it.each([
    { projectId: "8" },
    { chainId: 8453 as const },
    { suckerGroupId: "new group" },
    { token: "0xcccc" },
    { tokenSymbol: "USDC" },
    { tokenDecimals: 6 },
  ])("does not reuse data or placeholders when identity changes: %s", async (change) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(view(client));
    expect(await screen.findByText("price 9")).toBeInTheDocument();
    mocks.read.mockImplementationOnce(() => new Promise(() => {}));
    rendered.rerender(view(client, { ...props, ...change }));
    expect(screen.queryByText("price 9")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  });

  it("refreshes after the 15-second chart freshness window", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(view(client));
    expect(await screen.findByText("price 9")).toBeInTheDocument();
    rendered.unmount();
    now.mockReturnValue(1_015_001);
    mocks.read.mockResolvedValueOnce(history(3));
    render(view(client));
    expect(await screen.findByText("price 3")).toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
});
