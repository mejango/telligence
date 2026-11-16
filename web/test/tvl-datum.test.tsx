import { TvlDatum } from "@/app/[slug]/components/Header/TvlDatum";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({ getPublicClient: () => undefined }));

const projects = [{ chainId: 8453, projectId: 3 }];
const row = (symbol: string, balance: bigint, usd: bigint | null) => ({
  chainId: 8453,
  token: `0x${symbol.padEnd(40, "0")}`,
  symbol,
  decimals: 18,
  balance,
  usd,
});

function renderDatum(rows: ReturnType<typeof row>[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(
    ["revnet", "treasury", [[8453, 3]]],
    [{ chainId: 8453, verified: true, rows }],
  );
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TvlDatum projects={projects} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function stubViewport(mobile: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: mobile,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("header balance", () => {
  it("states a USD total only when every held token is priced", () => {
    stubViewport(false);
    renderDatum([row("ETH", 10n ** 18n, 3_000n * 10n ** 18n)]);
    expect(screen.getByText("$3,000.00")).toBeInTheDocument();
  });

  it("never reads $0.00 for a revnet whose holdings have no USD price", () => {
    stubViewport(false);
    renderDatum([row("ETH", 346n * 10n ** 15n, null)]);
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("does not state a partial USD total as the balance", () => {
    stubViewport(false);
    renderDatum([row("USDC", 10n ** 18n, 10n ** 18n), row("ETH", 10n ** 18n, null)]);
    expect(screen.queryByText("$1.00")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("reads a revnet holding nothing as $0.00", () => {
    stubViewport(false);
    renderDatum([row("ETH", 0n, 0n)]);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it.each([
    ["wide screens", false],
    ["phones", true],
  ])("opens the breakdown below its trigger on %s", async (_label, mobile) => {
    stubViewport(mobile);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return (
        this.getAttribute("role") === "tooltip"
          ? { left: 0, right: 320, top: 0, bottom: 230, width: 320, height: 230 }
          : { left: 227, right: 410, top: 160, bottom: 188, width: 183, height: 28 }
      ) as DOMRect;
    });
    renderDatum([row("ETH", 10n ** 18n, 3_000n * 10n ** 18n)]);
    if (mobile) fireEvent.click(screen.getByRole("button"));
    else fireEvent.focus(screen.getByRole("button"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveAttribute("data-side", "bottom");
    expect(tooltip.style.top).toBe("192px");
    expect(tooltip.style.left).toBe("227px");
  });
});
