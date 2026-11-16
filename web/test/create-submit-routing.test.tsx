import Page from "@/app/create/RevnetCreate";
import type { RevnetFormData } from "@/app/create/types";
import type { ReviewedRelayrRequest } from "@/hooks/useReviewedRelayr";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import {
  checkedItLabel,
  HELD_CONFIRMING_LINE,
  HELD_EXIT_LABEL,
  SAVED_ATTEMPT_UNREADABLE_LINE,
} from "@bananapus/nana-sdk-core/review";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { decodeFunctionData, encodeFunctionData, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_DEPLOYMENTS, TEST_ACCOUNT, validRevnetForm } from "./fixtures/revnet";

const CHECK_LABEL = checkedItLabel("Launch again");

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
  formProps: {} as { preferredPaymentChainId?: number },
  quote: vi.fn<(requests: ReviewedRelayrRequest[]) => Promise<undefined>>(),
  recoveryGuard: vi.fn(),
  pinMetadata: vi.fn(),
  creationFee: vi.fn(),
  feeds: vi.fn(),
  estimateGas: vi.fn(),
  write: vi.fn(),
  submittedViaSafe: vi.fn(),
  setSubmitting: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/layout/Nav", () => ({ Nav: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({ useAccount: () => mocks.account }));
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
vi.mock("@/lib/safe-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-connector")>()),
  isSafeConnector: (connector: { id: string }) => connector.id === "safe",
}));
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => {
  const { reviewedActionThrough } = await import("./support/reviewed-action");
  return {
    ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
    useReviewedAction: reviewedActionThrough(mocks.write, {
      proposed: (hash) => mocks.submittedViaSafe(hash),
    }).hook,
  };
});
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
vi.mock("@/app/create/form/DeployRevnetForm", () => ({
  DeployRevnetForm: (props: { preferredPaymentChainId?: number }) => {
    mocks.formProps = props;
    return null;
  },
}));
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
  // A launch an earlier test sent is journaled, as a real send's is.
  window.localStorage.clear();
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

describe("creation submit routing", () => {
  it("offers the launch fee on the chain the wallet was on before signing switched it", async () => {
    mocks.quote.mockImplementation(async () => {
      mocks.account = { ...mocks.account, chainId: 421614 };
      return undefined;
    });

    const view = render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Submit launch fixture" }));
    await waitFor(() => expect(mocks.setSubmitting).toHaveBeenLastCalledWith(false));
    view.rerender(<Page />);

    expect(mocks.quote).toHaveBeenCalledTimes(1);
    expect(mocks.formProps.preferredPaymentChainId).toBe(84532);
  });

  it("wallet-action:create-revnet quotes all four testnet deployments with their encoded calls and exact per-chain fees", async () => {
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
          description: expect.stringContaining("either live chains or test chains"),
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

    // The reviewed send switches the wallet to the call's chain.
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({
      chainId: 11155111,
      address: PROTOCOL_DEPLOYMENTS[11155111].revDeployer.address,
      functionName: "deployFor",
      value: 11155111n,
    });
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: route === "Safe" ? "Safe proposal submitted" : "Revnet deployment submitted",
      }),
    );
    // The normal path, as on main: one submit, one wallet send, and no recovery notice.
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a saved single-chain launch", () => {
  /** The journal an earlier visit's send left: reserved for the wallet, then the page closed. */
  async function savedEarlierLaunch() {
    const { launchKeyOf, launchNamespacesOf, saveLaunchAttempt } =
      await import("@/app/create/helpers/launchIntent");
    const { launchInputOf } = await import("@/app/create/helpers/launchIntent");
    const input = launchInputOf(mocks.form);
    saveLaunchAttempt(launchKeyOf(TEST_ACCOUNT, 11155111, input), {
      salt: `0x${"07".repeat(32)}`,
      fromBlock: 1_000n,
      namespaces: launchNamespacesOf(11155111, TEST_ACCOUNT, input),
      before: [],
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    mocks.form = { ...validRevnetForm(), chainIds: [11155111] };
  });

  it("is recovered before any preparation, so a failing upload can't hide its check", async () => {
    await savedEarlierLaunch();
    mocks.pinMetadata.mockRejectedValue(new Error("Pinning is down."));
    await submitFixture();

    // The chain can't show what became of it: the one explicit action, and nothing prepared.
    expect(await screen.findByRole("button", { name: CHECK_LABEL })).toBeVisible();
    expect(mocks.recoveryGuard).not.toHaveBeenCalled();
    expect(mocks.pinMetadata).not.toHaveBeenCalled();
    expect(mocks.creationFee).not.toHaveBeenCalled();
    expect(mocks.feeds).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("shows a held attempt's own line before any preparation, and sends nothing", async () => {
    await savedEarlierLaunch();
    const { launchInputOf, launchNamespacesOf } = await import("@/app/create/helpers/launchIntent");
    const { writeHolds } = await import("@/lib/write-hold");
    const node = {
      getChainId: async () => 11155111,
      getBlockNumber: async () => 100n,
      getBlock: async () => ({ number: 100n, hash: `0x${"bb".repeat(32)}` }),
      getTransactionCount: async () => 3,
      getTransaction: async () => ({ hash: DEPLOYMENT_HASH, nonce: 3, blockNumber: null }),
      getTransactionReceipt: async () => {
        throw new Error("not found");
      },
      request: async () => null,
    };
    // The wallet returned a hash, and the chain still has it pending.
    await writeHolds
      .open({
        chainId: 11155111,
        account: TEST_ACCOUNT,
        safe: false,
        namespace: launchNamespacesOf(11155111, TEST_ACCOUNT, launchInputOf(mocks.form))[0]!,
        call: {
          to: PROTOCOL_DEPLOYMENTS[11155111].revDeployer.address as `0x${string}`,
          data: "0x1234",
          value: 0n,
        },
      })
      .send(node as never, async (gate) => {
        await gate.beforeSend();
        gate.afterSubmit(DEPLOYMENT_HASH as `0x${string}`);
      });
    await submitFixture();

    // The hold's own line, with no exit while the chain still has it pending.
    expect(await screen.findByText(HELD_CONFIRMING_LINE)).toBeVisible();
    expect(screen.queryByRole("button", { name: CHECK_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: HELD_EXIT_LABEL })).toBeNull();
    expect(mocks.pinMetadata).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps following a launch that went through: only a fresh look, never a discard or a resend", async () => {
    const { launchKeyOf, launchInputOf } = await import("@/app/create/helpers/launchIntent");
    window.localStorage.setItem(
      launchKeyOf(TEST_ACCOUNT, 11155111, launchInputOf(mocks.form)),
      JSON.stringify({
        salt: `0x${"07".repeat(32)}`,
        fromBlock: "1000",
        namespaces: [],
        before: [],
        settled: { result: "success", hash: DEPLOYMENT_HASH },
      }),
    );
    await submitFixture();

    expect(await screen.findByRole("button", { name: "Check again" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /I checked it/ })).toBeNull();
    expect(mocks.pinMetadata).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("never lets a stale check retire a success another tab saved meanwhile", async () => {
    await savedEarlierLaunch();
    const { launchKeyOf, launchInputOf, savedLaunchAt } =
      await import("@/app/create/helpers/launchIntent");
    const key = launchKeyOf(TEST_ACCOUNT, 11155111, launchInputOf(mocks.form));
    render(<Page />);
    const check = await screen.findByRole("button", { name: CHECK_LABEL });
    // Another tab's recovery journals the earlier attempt's success while this check is shown.
    window.localStorage.setItem(
      key,
      JSON.stringify({
        ...savedLaunchAt(key),
        settled: { result: "success", hash: DEPLOYMENT_HASH },
      }),
    );
    fireEvent.click(check);

    expect(await screen.findByRole("button", { name: "Check again" })).toBeVisible();
    expect(savedLaunchAt(key)).toMatchObject({
      settled: { result: "success", hash: DEPLOYMENT_HASH },
    });
  });

  it("keeps the check and its button when the journal can't be read at the check", async () => {
    await savedEarlierLaunch();
    render(<Page />);
    const check = await screen.findByRole("button", { name: CHECK_LABEL });
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const removed = vi.spyOn(Storage.prototype, "removeItem");
    fireEvent.click(check);

    expect(await screen.findByText(SAVED_ATTEMPT_UNREADABLE_LINE)).toBeVisible();
    expect(screen.getByRole("button", { name: CHECK_LABEL })).toBeVisible();
    expect(removed).not.toHaveBeenCalled();
    read.mockRestore();
    removed.mockRestore();
  });

  it("offers the warned continue only after the check failed unreadable, and it launches anew", async () => {
    const { launchKeyOf, launchInputOf } = await import("@/app/create/helpers/launchIntent");
    const key = launchKeyOf(TEST_ACCOUNT, 11155111, launchInputOf(mocks.form));
    window.localStorage.setItem(key, "{not json");
    render(<Page />);
    const check = await screen.findByRole("button", { name: CHECK_LABEL });
    expect(
      screen.queryByRole("button", { name: "I checked my wallet. Continue anyway" }),
    ).toBeNull();
    fireEvent.click(check);
    expect(
      await screen.findByText(
        "This browser can't read its saved transactions. Check your wallet before sending again.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "I checked my wallet. Continue anyway" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: CHECK_LABEL })).toBeNull());
    // A submit recovers a journaled launch first, so the forced exit has to finish clearing it.
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Submit launch fixture" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
  });

  it("sends nothing and prepares nothing when the journal can't be read on submit", async () => {
    window.localStorage.setItem(
      (await import("@/app/create/helpers/launchIntent")).launchKeyOf(
        TEST_ACCOUNT,
        11155111,
        (await import("@/app/create/helpers/launchIntent")).launchInputOf(mocks.form),
      ),
      "{not json",
    );
    await submitFixture();

    expect(await screen.findByRole("button", { name: CHECK_LABEL })).toBeVisible();
    expect(mocks.pinMetadata).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("never lets a stale check delete a newer attempt another tab journaled", async () => {
    await savedEarlierLaunch();
    const { launchKeyOf, launchInputOf, savedLaunchAt } =
      await import("@/app/create/helpers/launchIntent");
    const key = launchKeyOf(TEST_ACCOUNT, 11155111, launchInputOf(mocks.form));
    render(<Page />);
    const check = await screen.findByRole("button", { name: CHECK_LABEL });
    // Another tab checked it too, relaunched with a fresh salt, and its wallet has it now.
    const newer = { salt: `0x${"08".repeat(32)}`, fromBlock: "2000", namespaces: [], before: [] };
    window.localStorage.setItem(key, JSON.stringify(newer));
    fireEvent.click(check);

    await waitFor(() => expect(savedLaunchAt(key)).toMatchObject({ salt: newer.salt }));
    expect(await screen.findByRole("button", { name: CHECK_LABEL })).toBeVisible();
  });

  it("shows the check when the mount scan can't read the chain", async () => {
    await savedEarlierLaunch();
    render(<Page />);
    expect(await screen.findByRole("button", { name: CHECK_LABEL })).toBeVisible();
  });

  it("launches again only after the user's check, keeping the checked attempt's salt", async () => {
    await savedEarlierLaunch();
    mocks.pinMetadata.mockResolvedValue("bafy-metadata");
    await submitFixture();
    fireEvent.click(await screen.findByRole("button", { name: CHECK_LABEL }));
    // Retired, the form reopens.
    await waitFor(() => expect(screen.queryByRole("button", { name: CHECK_LABEL })).toBeNull());
    mocks.setSubmitting.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Submit launch fixture" }));
    await waitFor(() => expect(mocks.setSubmitting).toHaveBeenLastCalledWith(false));

    expect(mocks.write).toHaveBeenCalledOnce();
    // If the checked attempt landed after all, this retry reverts instead of launching twice.
    const [{ args }] = mocks.write.mock.calls[0] as [{ args: readonly unknown[] }];
    expect(JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? `${v}` : v))).toContain(
      "07".repeat(32),
    );
  });

  it("launches a new attempt with a fresh salt", async () => {
    mocks.pinMetadata.mockResolvedValue("bafy-metadata");
    await submitFixture();
    expect(mocks.write).toHaveBeenCalledOnce();
    const [{ args }] = mocks.write.mock.calls[0] as [{ args: readonly unknown[] }];
    expect(JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? `${v}` : v))).not.toContain(
      "07".repeat(32),
    );
  });
});
