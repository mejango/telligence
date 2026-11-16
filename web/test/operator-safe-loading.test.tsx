import { OperatorAccountCard } from "@/app/[slug]/components/v6/operator/OperatorAccountCard";
import { SafeQueueCard } from "@/app/[slug]/components/v6/operator/SafeQueueCard";
import { authorityIdentityQuery } from "@/app/[slug]/components/v6/operator/authorityIdentityQuery";
import { safeProposalFor } from "@bananapus/nana-sdk-core/safe-service";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex, PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { provenSafe, queuedRow, safeChain } from "./fixtures/safe-chain";

vi.mock("@/hooks/useReviewedAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
  useSafeTransactionSignature: () => ({ signSafeTransactionAsync: mocks.sign }),
}));
vi.mock("@/lib/nana/groupWriteGate", () => import("./support/group-write-gate"));

const SAFE = provenSafe();
const TARGET = "0x4444444444444444444444444444444444444444" as Address;
const signature = (owner: Address) => `0x${owner.slice(2).padStart(128, "1")}1b` as Hex;
const mocks = vi.hoisted(() => ({
  clients: new Map<number, PublicClient>(),
  operators: new Map<number, Address>(),
  operatorsLoading: false,
  live: vi.fn(),
  write: vi.fn(),
  sign: vi.fn(),
  quote: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: SAFE.owners[0], chainId: 1 }),
  useConfig: () => ({}),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  publicClientFor: (chainId: number) => mocks.clients.get(chainId),
  isLiveRevnetOperator: mocks.live,
}));
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: () => ({
    operatorByChain: mocks.operatorsLoading ? new Map() : mocks.operators,
    discoveredOperatorByChain: mocks.operators,
    isLoading: mocks.operatorsLoading,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/app/[slug]/components/v6/operator/useOperatorWrites", () => ({
  useOperatorWrites: () => ({ runWrites: mocks.write }),
}));
vi.mock("@/hooks/useReviewedRelayr", async (importOriginal) => ({
  RelayrRecoveryError: (await importOriginal<typeof import("@/hooks/useReviewedRelayr")>())
    .RelayrRecoveryError,
  checkRelayrSession: vi.fn(),
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: mocks.quote, reset: vi.fn() }),
  useSendRelayrTx: () => ({ sendRelayrTx: vi.fn() }),
  waitForRelayrBundle: vi.fn(),
}));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    connectWalletText: _connect,
    loading: _loading,
    targetChainId: _chain,
    ...props
  }: {
    children: ReactNode;
    connectWalletText?: string;
    loading?: boolean;
    targetChainId?: number;
  }) => <button {...props}>{children}</button>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => (resolve = done)),
    resolve: (value: T) => resolve(value),
  };
}

function serveQueues() {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const chainId = String(input).includes("/v1/safe/base/") ? 8453 : 1;
    const transaction = queuedRow(
      chainId,
      SAFE.address,
      safeProposalFor({ to: TARGET, data: "0x1234" }, 5),
      SAFE.owners.map((owner) => ({ owner, signature: signature(owner) })),
    );
    return new Response(JSON.stringify({ next: null, results: [transaction] }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function renderCards(chainIds: (1 | 8453)[] = [1, 8453]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rows = chainIds.map((chainId) => ({ chainId, projectId: 42 }));
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OperatorAccountCard rows={rows} fallbackProject={rows[0]!} />
      <SafeQueueCard rows={rows} fallbackProject={rows[0]!} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function section(title: string) {
  return within(screen.getByRole("heading", { name: title }).closest("section")!);
}

function identityReadCount(chain: ReturnType<typeof safeChain>) {
  return chain.getCode.mock.calls.filter(
    ([{ address }]) => address.toLowerCase() === SAFE.address.toLowerCase(),
  ).length;
}

beforeEach(() => {
  mocks.clients.clear();
  mocks.operators = new Map([
    [1, SAFE.address],
    [8453, SAFE.address],
  ]);
  mocks.operatorsLoading = false;
  mocks.live.mockResolvedValue(true);
  window.localStorage.clear();
});

describe("operator Account and Safe queue loading", () => {
  it("starts service reads during identity checks, renders the faster chain, and shares each identity read", async () => {
    const ethereum = safeChain(SAFE.address, { nonce: 5n });
    const base = safeChain(SAFE.address, { nonce: 5n });
    const readBaseCode = base.getCode.getMockImplementation()!;
    const code = await readBaseCode({ address: SAFE.address });
    const pendingBase = deferred<typeof code>();
    base.getCode.mockImplementation((args) =>
      args.address.toLowerCase() === SAFE.address.toLowerCase()
        ? pendingBase.promise
        : readBaseCode(args),
    );
    mocks.clients.set(1, ethereum.client).set(8453, base.client);
    const fetch = serveQueues();
    renderCards();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        section("Pending multisig transactions").getAllByRole("button", { name: "Execute" }),
      ).toHaveLength(1),
    );
    expect(section("Account").getByText("Safe multisig")).toBeVisible();
    expect(section("Account").getByText("Checking…")).toBeVisible();
    expect(identityReadCount(ethereum)).toBe(1);
    expect(identityReadCount(base)).toBe(1);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();

    await act(async () => pendingBase.resolve(code));
    await waitFor(() =>
      expect(
        section("Pending multisig transactions").getAllByRole("button", { name: "Execute" }),
      ).toHaveLength(2),
    );
    expect(section("Account").queryByText("Checking…")).toBeNull();
    expect(identityReadCount(ethereum)).toBe(1);
    expect(identityReadCount(base)).toBe(1);
  });

  it("keeps failed identity checks visible and non-actionable, then recovers both cards through retry", async () => {
    const ethereum = safeChain(SAFE.address, { nonce: 5n });
    const readCode = ethereum.getCode.getMockImplementation()!;
    let unavailable = true;
    ethereum.getCode.mockImplementation(async (args) => {
      if (unavailable && args.address.toLowerCase() === SAFE.address.toLowerCase()) {
        throw new Error("RPC temporarily unavailable");
      }
      return readCode(args);
    });
    mocks.clients.set(1, ethereum.client);
    serveQueues();
    renderCards([1]);

    expect(await screen.findByText("Could not verify", { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry account checks" })).toBeEnabled();
    const retryQueue = await screen.findByRole("button", { name: "Retry Ethereum queue" });
    expect(screen.queryByRole("button", { name: "Execute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign" })).toBeNull();
    expect(identityReadCount(ethereum)).toBe(2);

    unavailable = false;
    fireEvent.click(retryQueue);

    expect(await screen.findByRole("button", { name: "Execute" })).toBeEnabled();
    expect(section("Account").getByText("Safe multisig")).toBeVisible();
    expect(screen.queryByText("Could not verify", { exact: true })).toBeNull();
    expect(identityReadCount(ethereum)).toBe(3);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it("loads a discovered chain while another chain's live operator is still unresolved", async () => {
    mocks.operators = new Map([[1, SAFE.address]]);
    mocks.operatorsLoading = true;
    mocks.clients.set(1, safeChain(SAFE.address, { nonce: 5n }).client);
    const fetch = serveQueues();
    renderCards();

    expect(await screen.findByRole("button", { name: "Execute" })).toBeEnabled();
    expect(section("Account").getByText("Safe multisig")).toBeVisible();
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("replaces a previously verified Account policy with an explicit error when a background refresh fails", async () => {
    const ethereum = safeChain(SAFE.address, { nonce: 5n });
    const readCode = ethereum.getCode.getMockImplementation()!;
    mocks.clients.set(1, ethereum.client);
    serveQueues();
    const { queryClient } = renderCards([1]);
    expect(await section("Account").findByText("Safe multisig")).toBeVisible();
    expect(section("Account").getByText("Requires 2 of 2 signatures")).toBeVisible();

    ethereum.getCode.mockRejectedValue(new Error("RPC temporarily unavailable"));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: authorityIdentityQuery(1, SAFE.address).queryKey,
      });
    });

    expect(await section("Account").findByText("Could not verify")).toBeVisible();
    expect(section("Account").queryByText("Safe multisig")).toBeNull();
    expect(section("Account").queryByText("Requires 2 of 2 signatures")).toBeNull();
    expect(
      section("Account").queryByRole("button", { name: "Transfer revnet operator" }),
    ).toBeNull();
    const retry = section("Account").getByRole("button", { name: "Retry account checks" });
    expect(retry).toBeEnabled();

    ethereum.getCode.mockImplementation(readCode);
    fireEvent.click(retry);

    expect(await section("Account").findByText("Safe multisig")).toBeVisible();
    expect(section("Account").getByText("Requires 2 of 2 signatures")).toBeVisible();
    expect(section("Account").queryByText("Could not verify")).toBeNull();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("omits the Safe queue for a verified EOA even when the speculative Safe nonce read fails", async () => {
    const ethereum = safeChain(null);
    ethereum.getCode.mockResolvedValue("0x");
    ethereum.request.mockResolvedValue("0x");
    mocks.clients.set(1, ethereum.client);
    const fetch = serveQueues();
    renderCards([1]);

    expect(await section("Account").findByText("Wallet", { exact: true })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Pending multisig transactions" })).toBeNull(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Execute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
