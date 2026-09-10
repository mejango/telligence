import { computeFactoryAbi } from "@/lib/telligence/factory";
import { pendingLaunchKey } from "@/lib/telligence/pending-launch";
import { VVV_ADDRESS } from "@/lib/telligence/transactions";
import { DEFAULT_COMPUTE_DRAFT } from "@/lib/telligence/types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { encodeAbiParameters, encodeEventTopics, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111" as Address,
  session: null as null | { address: Address; csrfToken: string },
  authenticate: vi.fn(),
  gateway: vi.fn(),
  write: vi.fn(),
  pin: vi.fn(),
  read: vi.fn(),
  block: vi.fn(),
  receipt: vi.fn(),
  push: vi.fn(),
  activity: vi.fn(),
  requireExecution: vi.fn(),
  viewAs: vi.fn(),
  beforeSubmission: undefined as undefined | (() => Promise<void>),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address }), useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({ getAccount: () => ({ address: mocks.address, chainId: 8453 }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/useCreatorSession", () => ({
  useCreatorSession: () => ({
    session: mocks.session,
    authenticate: mocks.authenticate,
    loading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  useWriteContract: (options: { beforeSubmission?: () => Promise<void> }) => {
    mocks.beforeSubmission = options.beforeSubmission;
    return { writeContractAsync: mocks.write };
  },
  requireOnchainExecution: (...args: unknown[]) => mocks.requireExecution(...args),
}));
vi.mock("@/lib/telligence/api", () => ({
  gatewayRequest: (...args: unknown[]) => mocks.gateway(...args),
}));
vi.mock("@/lib/jbcenter-ipfs", () => ({
  jbCenterIpfs: { pinJson: (...args: unknown[]) => mocks.pin(...args) },
}));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: () => ({ readContract: mocks.read, getBlock: mocks.block }),
}));
vi.mock("@/lib/waitForReceipt", () => ({
  waitForReceiptWithRetry: (...args: unknown[]) => mocks.receipt(...args),
}));
vi.mock("@/lib/transaction-activity", () => ({
  transactionActivityForHash: (...args: unknown[]) => mocks.activity(...args),
}));
vi.mock("@/lib/view-as", () => ({ requireNoViewAs: () => mocks.viewAs() }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    targetChainId?: number;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

import { LaunchComputeProjectButton } from "@/components/telligence/LaunchComputeProjectButton";

const CREATOR = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const FACTORY = "0x3333333333333333333333333333333333333333" as const;
const TERMINAL = "0x4444444444444444444444444444444444444444" as const;
const POLICY = "0x5555555555555555555555555555555555555555" as const;
const VAULT = "0x6666666666666666666666666666666666666666" as const;
const RECOVERY = "0x7777777777777777777777777777777777777777" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const EXECUTION_HASH = `0x${"cd".repeat(32)}` as const;
const PREPARATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT = {
  ...DEFAULT_COMPUTE_DRAFT,
  name: "Public archive",
  purpose: "Make public records searchable for everyone",
  workload: "Summarize public records",
  recoveryAddress: RECOVERY,
};
const CONFIG = {
  ready: true,
  policyVersion: "2" as const,
  chainId: 8453,
  factoryAddress: FACTORY,
  canonicalTerminal: TERMINAL,
  vvvAddress: VVV_ADDRESS,
  launchPolicy: {
    conversionCadence: "3600",
    minBatchTokens: "1000000000000000000",
    maxBatchTokens: "100000000000000000000",
    minVVVPerProjectToken: "1000",
    minDiemPerVVV: "1000",
    maxPrincipal: "1000000000000000000000",
    initialIssuance: "1000000000000000000",
  },
};
const PENDING = {
  version: 1,
  creator: CREATOR,
  factory: FACTORY,
  hash: HASH,
  preparationId: PREPARATION_ID,
  draft: DRAFT,
};
function receipt(creator: Address = CREATOR) {
  return {
    status: "success",
    logs: [
      {
        address: FACTORY,
        topics: encodeEventTopics({
          abi: computeFactoryAbi,
          eventName: "DeployProject",
          args: { revnetId: 7n, creator },
        }),
        data: encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "bytes32" }],
          [POLICY, VAULT, `0x${"01".repeat(32)}`],
        ),
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function component(config: typeof CONFIG | null = CONFIG) {
  return <LaunchComputeProjectButton draft={DRAFT} reviewedConfig={config} />;
}
function clickLaunch() {
  fireEvent.click(screen.getByRole("button"));
}
function callsTo(path: string) {
  return mocks.gateway.mock.calls.filter(([called]) => called === path);
}

beforeEach(() => {
  localStorage.clear();
  mocks.address = CREATOR;
  mocks.session = { address: CREATOR, csrfToken: "csrf" };
  mocks.gateway.mockImplementation(async (path: string) => {
    if (path === "/v1/config") return CONFIG;
    if (path === "/v1/projects/prepare")
      return {
        preparationId: PREPARATION_ID,
        inferenceSigner: OTHER,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    if (path === "/v1/projects") return { project: { id: "project-7" } };
    throw new Error(`Unexpected route ${path}`);
  });
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === "MULTI_TERMINAL"
      ? TERMINAL
      : functionName === "creationFee"
        ? 5n
        : functionName === "getDiemAmountOut"
          ? 10n ** 18n
          : OTHER,
  );
  mocks.block.mockResolvedValue({ timestamp: 1_800_000_000n });
  mocks.pin.mockResolvedValue({ cid: "bafyproject" });
  mocks.write.mockResolvedValue(HASH);
  mocks.receipt.mockResolvedValue(receipt());
  mocks.activity.mockReturnValue(undefined);
});

describe("wallet-action:telligence-launch compute launch wallet lifecycle", () => {
  it("registers only the confirmed factory identity and exact creator", async () => {
    render(component());
    clickLaunch();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/compute/project-7/keys"));
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(callsTo("/v1/projects")[0]?.[1]).toMatchObject({
      method: "POST",
      csrfToken: "csrf",
      body: {
        revnetId: "7",
        wrapperAddress: POLICY,
        vaultAddress: VAULT,
        preparationId: PREPARATION_ID,
      },
    });
    expect(localStorage.getItem(pendingLaunchKey(CREATOR))).toBeNull();
  });

  it.each([
    ["", null],
    ["25.50", "25.50"],
  ])(
    "preserves the optional target %j across metadata and confirmed registration",
    async (target, serialized) => {
      render(
        <LaunchComputeProjectButton
          draft={{ ...DRAFT, targetDailyCreditUsd: target as string }}
          reviewedConfig={CONFIG}
        />,
      );
      clickLaunch();
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/compute/project-7/keys"));
      expect(mocks.pin).toHaveBeenCalledWith(
        expect.objectContaining({
          telligence: expect.objectContaining({ targetDailyCreditUsd: serialized }),
        }),
      );
      expect(callsTo("/v1/projects")[0]?.[1]).toMatchObject({
        body: { targetDailyCreditUsd: serialized },
      });
    },
  );

  it("retries registration after a gateway failure without another deployment or signer", async () => {
    const gateway = mocks.gateway.getMockImplementation()!;
    let attempts = 0;
    mocks.gateway.mockImplementation(async (...args) => {
      if (args[0] === "/v1/projects" && attempts++ === 0)
        throw new Error("Registration unavailable");
      return gateway(...args);
    });
    render(component());
    clickLaunch();
    expect(await screen.findByRole("alert")).toHaveTextContent("Registration unavailable");
    expect(localStorage.getItem(pendingLaunchKey(CREATOR))).not.toBeNull();
    clickLaunch();
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(callsTo("/v1/projects/prepare")).toHaveLength(1);
  });

  it("resumes after a reload even when the reviewed launch preset changes", async () => {
    localStorage.setItem(pendingLaunchKey(CREATOR), JSON.stringify(PENDING));
    render(component(null));
    fireEvent.click(await screen.findByRole("button", { name: "Resume project registration" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.write).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects/prepare")).toHaveLength(0);
  });

  it("keeps Safe proposals saved and resumes with the actual execution receipt", async () => {
    mocks.requireExecution.mockImplementationOnce(() => {
      throw new Error("Safe proposal is awaiting execution");
    });
    render(component());
    clickLaunch();
    expect(await screen.findByRole("alert")).toHaveTextContent("Safe proposal");
    expect(mocks.receipt).not.toHaveBeenCalled();
    mocks.activity.mockReturnValue({ executionHash: EXECUTION_HASH });
    clickLaunch();
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.receipt).toHaveBeenCalledWith(expect.anything(), EXECUTION_HASH);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("stops before signer preparation if the account changes during configuration", async () => {
    const pendingConfig = deferred<typeof CONFIG>();
    mocks.gateway.mockReturnValueOnce(pendingConfig.promise);
    render(component());
    clickLaunch();
    mocks.address = OTHER;
    await act(async () => pendingConfig.resolve(CONFIG));
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
    expect(mocks.write).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects/prepare")).toHaveLength(0);
  });

  it("preserves the original creator's submitted launch after an account switch", async () => {
    const waiting = deferred<ReturnType<typeof receipt>>();
    mocks.receipt.mockReturnValueOnce(waiting.promise);
    const view = render(component());
    clickLaunch();
    await waitFor(() => expect(mocks.receipt).toHaveBeenCalled());
    mocks.address = OTHER;
    mocks.session = { address: OTHER, csrfToken: "other" };
    view.rerender(component());
    await act(async () => waiting.resolve(receipt()));
    expect(callsTo("/v1/projects")).toHaveLength(0);
    expect(localStorage.getItem(pendingLaunchKey(CREATOR))).not.toBeNull();
    mocks.address = CREATOR;
    mocks.session = { address: CREATOR, csrfToken: "csrf" };
    view.rerender(component());
    fireEvent.click(await screen.findByRole("button", { name: "Resume project registration" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("reads a launch saved by another tab before offering a new transaction", async () => {
    render(component());
    localStorage.setItem(pendingLaunchKey(CREATOR), JSON.stringify(PENDING));
    clickLaunch();
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.write).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects/prepare")).toHaveLength(0);
  });

  it("blocks corrupt saved submission data rather than discarding recovery state", async () => {
    localStorage.setItem(pendingLaunchKey(CREATOR), "{broken");
    render(component());
    clickLaunch();
    expect(await screen.findByRole("alert")).toHaveTextContent(/saved launch|recovery/i);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects/prepare")).toHaveLength(0);
    expect(localStorage.getItem(pendingLaunchKey(CREATOR))).toBe("{broken");
  });

  it("rejects changed financial policy before preparing or requesting a wallet write", async () => {
    mocks.gateway.mockResolvedValueOnce({
      ...CONFIG,
      launchPolicy: { ...CONFIG.launchPolicy, minDiemPerVVV: "2000" },
    });
    render(component());
    clickLaunch();
    expect(await screen.findByRole("alert")).toHaveTextContent(/policy.*changed|terms.*changed/i);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects/prepare")).toHaveLength(0);
  });

  it("rejects changing the operator allocation while metadata is being prepared", async () => {
    const pinning = deferred<{ cid: string }>();
    mocks.pin.mockReturnValueOnce(pinning.promise);
    const view = render(component());
    clickLaunch();
    await waitFor(() => expect(mocks.pin).toHaveBeenCalled());
    view.rerender(
      <LaunchComputeProjectButton
        draft={{ ...DRAFT, operatorSplitBps: 1000 }}
        reviewedConfig={CONFIG}
      />,
    );
    await act(async () => pinning.resolve({ cid: "bafyproject" }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects")).toHaveLength(0);
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed|review/i);
  });

  it("requires the reviewed financial preset before a new launch", () => {
    render(component(null));
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("rejects a malformed signer preparation before the wallet boundary", async () => {
    const gateway = mocks.gateway.getMockImplementation()!;
    mocks.gateway.mockImplementation(async (...args) =>
      args[0] === "/v1/projects/prepare"
        ? { preparationId: "invalid", inferenceSigner: OTHER, expiresAt: "not a date" }
        : gateway(...args),
    );
    render(component());
    clickLaunch();
    expect(await screen.findByRole("alert")).toHaveTextContent(/preparation/i);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("retains recovery when a successful receipt has no matching creator event", async () => {
    mocks.receipt.mockResolvedValueOnce(receipt(OTHER));
    render(component());
    clickLaunch();
    expect(await screen.findByRole("alert")).toHaveTextContent("matching deployment event");
    expect(callsTo("/v1/projects")).toHaveLength(0);
    expect(localStorage.getItem(pendingLaunchKey(CREATOR))).not.toBeNull();
  });

  it("allows another attempt only after a mined revert proves no project was created", async () => {
    mocks.receipt.mockResolvedValueOnce({ status: "reverted", logs: [] });
    render(component());
    clickLaunch();
    expect(await screen.findByRole("alert")).toHaveTextContent("launch reverted");
    expect(localStorage.getItem(pendingLaunchKey(CREATOR))).toBeNull();
    clickLaunch();
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });
  it("never opens a wallet after the launch form unmounts during metadata preparation", async () => {
    const pinning = deferred<{ cid: string }>();
    mocks.pin.mockReturnValueOnce(pinning.promise);
    const view = render(component());
    clickLaunch();
    await waitFor(() => expect(mocks.pin).toHaveBeenCalled());
    view.unmount();
    await act(async () => pinning.resolve({ cid: "bafyproject" }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects")).toHaveLength(0);
  });

  it("preserves a submitted transaction after unmount without advancing registration", async () => {
    const submitted = deferred<typeof HASH>();
    mocks.write.mockReturnValueOnce(submitted.promise);
    const view = render(component());
    clickLaunch();
    await waitFor(() => expect(mocks.write).toHaveBeenCalled());
    view.unmount();
    await act(async () => submitted.resolve(HASH));
    expect(localStorage.getItem(pendingLaunchKey(CREATOR))).not.toBeNull();
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects")).toHaveLength(0);
  });

  it("stops a stale draft before wallet submission when the creator edits its terms", async () => {
    const pinning = deferred<{ cid: string }>();
    mocks.pin.mockReturnValueOnce(pinning.promise);
    const view = render(component());
    clickLaunch();
    await waitFor(() => expect(mocks.pin).toHaveBeenCalled());
    view.rerender(
      <LaunchComputeProjectButton
        draft={{ ...DRAFT, name: "Changed project" }}
        reviewedConfig={CONFIG}
      />,
    );
    await act(async () => pinning.resolve({ cid: "bafyproject" }));
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rechecks lifecycle at the reviewed hook's final wallet boundary", async () => {
    const estimate = deferred<void>();
    const broadcast = vi.fn().mockResolvedValue(HASH);
    mocks.write.mockImplementationOnce(async () => {
      await estimate.promise;
      await mocks.beforeSubmission?.();
      return broadcast();
    });
    const view = render(component());
    clickLaunch();
    await waitFor(() => expect(mocks.write).toHaveBeenCalled());
    view.unmount();
    await act(async () => estimate.resolve());
    expect(broadcast).not.toHaveBeenCalled();
    expect(localStorage.getItem(pendingLaunchKey(CREATOR))).toBeNull();
  });
  it("waits on the creator launch lock and rereads submission state before preparing", async () => {
    const release = deferred<void>();
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      await release.promise;
      return callback();
    });
    vi.stubGlobal("navigator", { locks: { request } });
    render(component());
    clickLaunch();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `telligence:launch:8453:${CREATOR}`,
        expect.any(Function),
      ),
    );
    expect(mocks.gateway).not.toHaveBeenCalled();
    localStorage.setItem(pendingLaunchKey(CREATOR), JSON.stringify(PENDING));
    await act(async () => release.resolve());
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.write).not.toHaveBeenCalled();
    expect(callsTo("/v1/projects/prepare")).toHaveLength(0);
  });
});
