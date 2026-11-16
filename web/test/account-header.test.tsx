import { AccountHeader } from "@/app/account/[id]/components/AccountHeader";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x823b92d6a4b2AED4b15675c7917c9f922ea8ADAD" as Address;
const OTHER = "0x1111111111111111111111111111111111111111" as Address;

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: wallet.address }),
  usePublicClient: () => ({ getEnsName: async () => "jango.eth" }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/EtherscanLink", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

function renderHeader(props: { ensName?: string } = {}) {
  const client = new QueryClient();
  client.setQueryData(["ensName", ACCOUNT, mainnet.id], "jango.eth");
  render(
    <QueryClientProvider client={client}>
      <AccountHeader address={ACCOUNT} {...props} />
    </QueryClientProvider>,
  );
}

describe("AccountHeader", () => {
  beforeEach(() => {
    wallet.address = undefined;
    clearViewAs();
  });

  it("does not call a viewed account yours without a wallet", () => {
    setViewAs(ACCOUNT);
    renderHeader();
    expect(screen.queryByText("This is you")).toBeNull();
  });

  it("does not call a viewed account yours with another wallet connected", () => {
    wallet.address = OTHER;
    setViewAs(ACCOUNT);
    renderHeader();
    expect(screen.queryByText("This is you")).toBeNull();
  });

  it("calls the connected wallet's own page yours", () => {
    wallet.address = ACCOUNT;
    renderHeader();
    expect(screen.getByText("This is you")).toBeTruthy();
  });

  it.each([[{}], [{ ensName: "jango.eth" }]])(
    "shows the name once and the full address under it (%j)",
    async (props) => {
      renderHeader(props);
      expect(await screen.findAllByText("jango.eth")).toHaveLength(1);
      expect(screen.getByText(ACCOUNT)).toBeTruthy();
    },
  );
});
