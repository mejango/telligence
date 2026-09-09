import Page from "@/app/create/RevnetCreate";
import type { RevnetFormData } from "@/app/create/types";
import type { ReviewedRelayrRequest } from "@/hooks/useReviewedRelayr";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { decodeFunctionData, encodeFunctionData, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_DEPLOYMENTS, TEST_ACCOUNT, validRevnetForm } from "./fixtures/revnet";

const TESTNETS: JBChainId[] = [11155111, 11155420, 84532, 421614];
const DEPLOYMENT_HASH = `0x${"ab".repeat(32)}`;
const mocks = vi.hoisted(() => ({
  account: {
    address: "" as Address,
    chainId: 84532,
    isConnected: true,
    connector: { id: "injected", name: "Injected" },
  },
  form: {} as RevnetFormData,
  quote: vi.fn<(requests: ReviewedRelayrRequest[]) => Promise<undefined>>(),
  recoveryGuard: vi.fn(),
  pinMetadata: vi.fn(),
  creationFee: vi.fn(),
  feeds: vi.fn(),
  estimateGas: vi.fn(),
  write: vi.fn(),
  submittedViaSafe: vi.fn(),
  switchChain: vi.fn(),
  setSubmitting: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/layout/Nav", () => ({ Nav: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));
vi.mock("wagmi/actions", () => ({
  getPublicClient: (_config: unknown, { chainId }: { chainId: number }) => ({
    chain: { id: chainId },
    estimateContractGas: mocks.estimateGas,
  }),
}));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: mocks.quote }),
  requireRelayrRecoveryScopeAvailable: (...args: unknown[]) => mocks.recoveryGuard(...args),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
  isSafeConnector: (connector: { id: string }) => connector.id === "safe",
  submittedViaSafe: (...args: unknown[]) => mocks.submittedViaSafe(...args),
}));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getProjectCreationFee: (...args: unknown[]) => mocks.creationFee(...args),
}));
vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({
  pinProjectMetadata: (...args: unknown[]) => mocks.pinMetadata(...args),
}));
vi.mock("@/app/create/helpers/feedReachability", () => ({
  assertLaunchFeedsReachable: (...args: unknown[]) => mocks.feeds(...args),
}));
vi.mock("@/app/create/form/DeployRevnetForm", () => ({ DeployRevnetForm: () => null }));
vi.mock("@/lib/forms", () => ({
  FormProvider: ({
    children,
    onSubmit,
  }: {
    children: ReactNode;
    onSubmit: (
      values: RevnetFormData,
      helpers: { setSubmitting: (submitting: boolean) => void },
    ) => Promise<void>;
  }) => (
    <>
      <button onClick={() => void onSubmit(mocks.form, { setSubmitting: mocks.setSubmitting })}>
        Submit launch fixture
      </button>
      {children}
    </>
  ),
}));

beforeEach(() => {
  mocks.account = {
    address: TEST_ACCOUNT,
    chainId: 84532,
    isConnected: true,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.form = { ...validRevnetForm(), chainIds: [...TESTNETS] };
  mocks.pinMetadata.mockResolvedValue("bafy-metadata");
  mocks.creationFee.mockImplementation(async (_client, chainId: number) => BigInt(chainId));
  mocks.estimateGas.mockResolvedValue(1_000_000n);
  mocks.write.mockResolvedValue(DEPLOYMENT_HASH);
  mocks.submittedViaSafe.mockReturnValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

async function submitFixture() {
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Submit launch fixture" }));
  await waitFor(() => expect(mocks.setSubmitting).toHaveBeenLastCalledWith(false));
}

describe("wallet-action:create-revnet — creation submit routing", () => {
  it("quotes all four testnet deployments with their encoded calls and exact per-chain fees", async () => {
    await submitFixture();

    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.pinMetadata).toHaveBeenCalledTimes(1);
    expect(mocks.recoveryGuard).toHaveBeenCalledExactlyOnceWith(TEST_ACCOUNT, "revnet-launch");
    expect(mocks.quote).toHaveBeenCalledTimes(1);
    const [requests] = mocks.quote.mock.calls[0];
    expect(requests.map(({ chainId }) => chainId)).toEqual(TESTNETS);
    expect(mocks.feeds.mock.calls.map(([request]) => request.chainId)).toEqual(TESTNETS);
    for (const request of requests) {
      expect(request.recoveryScope).toBe("revnet-launch");
      expect(request.data.from).toBe(TEST_ACCOUNT);
      expect(request.data.to).toBe(
        PROTOCOL_DEPLOYMENTS[String(request.chainId) as keyof typeof PROTOCOL_DEPLOYMENTS]
          .revDeployer.address,
      );
      expect(request.data.value).toBe(BigInt(request.chainId));
      const decoded = decodeFunctionData({ abi: request.review!.abi!, data: request.data.data });
      expect(decoded.functionName).toBe("deployFor");
      expect(request.data.data).toBe(
        encodeFunctionData({
          abi: request.review!.abi!,
          functionName: request.review!.functionName!,
          args: request.review!.args,
        }),
      );
    }
    expect(mocks.switchChain).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([
    [1, 84532],
    [11155111, 10],
  ])(
    "rejects mixed-family submit before metadata or wallet actions (%s, %s)",
    async (...chainIds) => {
      mocks.form.chainIds = chainIds as JBChainId[];
      await submitFixture();

      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          description: expect.stringContaining("all mainnets or all testnets"),
        }),
      );
      expect(mocks.recoveryGuard).not.toHaveBeenCalled();
      expect(mocks.pinMetadata).not.toHaveBeenCalled();
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("rejects a Safe multichain testnet submit before metadata or quote creation", async () => {
    mocks.account.connector = { id: "safe", name: "Safe" };
    await submitFixture();

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "For a Safe deployment, select one chain." }),
    );
    expect(mocks.pinMetadata).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("preserves the pending launch recovery guard before testnet metadata or quotes", async () => {
    mocks.recoveryGuard.mockImplementation(() => {
      throw new Error("Resume the pending launch first.");
    });
    await submitFixture();

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Resume the pending launch first." }),
    );
    expect(mocks.pinMetadata).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["EOA", "Safe"])("preserves the direct single-testnet %s route", async (route) => {
    mocks.form.chainIds = [11155111];
    if (route === "Safe") {
      mocks.account.connector = { id: "safe", name: "Safe" };
      mocks.submittedViaSafe.mockReturnValue(true);
    }
    await submitFixture();

    expect(mocks.switchChain).toHaveBeenCalledExactlyOnceWith({ chainId: 11155111 });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        chainId: 11155111,
        address: PROTOCOL_DEPLOYMENTS[11155111].revDeployer.address,
        functionName: "deployFor",
        value: 11155111n,
      }),
    );
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: route === "Safe" ? "Safe proposal submitted" : "Revnet deployment submitted",
      }),
    );
  });
});
