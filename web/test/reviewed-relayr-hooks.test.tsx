import type { ReviewedRelayrRequest } from "@/hooks/useReviewedRelayr";
import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import { JB_PROJECT_PAYER_DEPLOYER, jbProjectPayerDeployerAbi } from "@bananapus/nana-sdk-core/v6";
import { act, renderHook } from "@testing-library/react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT,
  BLOCK_HASH,
  BUNDLE_UUID,
  HASH,
  NOW,
  PAYMENT_RUNTIME,
  PAYMENT_TARGET,
  TARGET,
  onchain,
  payment,
} from "./relayr-fixtures";

const mocks = vi.hoisted(() => ({
  config: { id: "relayr-test-config" },
  hookAddress: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
  account: {
    address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
    chainId: 1 as number | undefined,
    connector: { id: "injected", name: "Injected" } as { id: string; name: string } | undefined,
  },
  getAccount: vi.fn(),
  getPublicClient: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  switchChain: vi.fn(),
  signTypedData: vi.fn(),
  sendTransaction: vi.fn(),
  resumeSafeProposalTracking: vi.fn(),
  clientCall: vi.fn(),
  readContract: vi.fn(),
  estimateGas: vi.fn(),
  getCode: vi.fn(),
  getTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getPublicClient: mocks.getPublicClient,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.hookAddress }),
  useConfig: () => mocks.config,
  useSendTransaction: () => ({
    data: undefined,
    error: null,
    isPending: false,
    isSuccess: false,
    sendTransactionAsync: mocks.sendTransaction,
  }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedData }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: mocks.config }));

const OTHER_ACCOUNT = "0x000000000000000000000000000000000000bEEF" as Address;
const SIGNATURE = `0x${"12".repeat(65)}` as Hex;

const REQUEST = {
  chainId: 1 as const,
  data: {
    from: ACCOUNT,
    to: TARGET,
    value: 3n,
    gas: 100_000n,
    data: "0x1234" as Hex,
  },
  review: { label: "Deploy revnet", contractName: "REVDeployer" },
};

function quote(row = payment()): RelayrPostBundleResponse {
  return {
    bundle_uuid: BUNDLE_UUID,
    payment_info: [row],
    per_txn: [],
    txn_uuids: ["tx-reviewed"],
  };
}

async function freshHarness() {
  vi.resetModules();
  const [review, activity, hooks] = await Promise.all([
    import("@/lib/transaction-review"),
    import("@/lib/transaction-activity"),
    import("@/hooks/useReviewedRelayr"),
  ]);
  return { review, activity, hooks };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.setSystemTime(new Date(NOW * 1_000));
  mocks.hookAddress = ACCOUNT;
  mocks.account = {
    address: ACCOUNT,
    chainId: 1,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.getPublicClient.mockReturnValue({
    call: mocks.clientCall,
    readContract: mocks.readContract,
    estimateGas: mocks.estimateGas,
    getCode: mocks.getCode,
    getTransaction: mocks.getTransaction,
    getTransactionReceipt: mocks.getTransactionReceipt,
    getBlock: mocks.getBlock,
  });
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account.chainId = chainId;
  });
  mocks.clientCall.mockResolvedValue({ data: "0x" });
  mocks.readContract.mockImplementation(
    async ({ functionName, address }: { functionName: string; address: Address }) =>
      functionName === "isTrustedForwarder"
        ? true
        : functionName === "eip712Domain"
          ? ["0x0f", "Juicebox", "1", BigInt(mocks.account.chainId!), address, HASH, []]
          : 4n,
  );
  mocks.getCode.mockResolvedValue(PAYMENT_RUNTIME);
  mocks.getTransaction.mockResolvedValue(onchain(PAYMENT_TARGET, payment().calldata));
  mocks.getTransactionReceipt.mockResolvedValue(onchain(PAYMENT_TARGET, payment().calldata));
  mocks.getBlock.mockResolvedValue({ hash: BLOCK_HASH });
  mocks.estimateGas.mockResolvedValue(21_000n);
  mocks.signTypedData.mockResolvedValue(SIGNATURE);
  mocks.sendTransaction.mockResolvedValue(HASH);
  mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
});

describe("reviewed Relayr authorization hook", () => {
  it("simulates, reviews, signs the exact forward request, and posts only after account rechecks", async () => {
    const events: string[] = [];
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      events.push("review");
      expect(request).toMatchObject({ kind: "authorization" });
      expect(request.calls[0]).toMatchObject({
        chainId: 1,
        from: ACCOUNT,
        to: TARGET,
        value: 3n,
        data: "0x1234",
      });
      expect(request.authorization).toMatchObject({
        primaryType: "ForwardRequest",
        message: { from: ACCOUNT, to: TARGET, nonce: 4n },
      });
      return true;
    });
    mocks.switchChain.mockImplementation(async () => events.push("switch"));
    mocks.clientCall.mockImplementation(async () => events.push("simulate"));
    mocks.readContract.mockImplementation(
      async ({ functionName, address }: { functionName: string; address: Address }) => {
        if (functionName === "isTrustedForwarder") return true;
        if (functionName === "eip712Domain")
          return ["0x0f", "Juicebox", "1", 1n, address, HASH, []];
        events.push("nonce");
        return 4n;
      },
    );
    mocks.signTypedData.mockImplementation(async (request) => {
      events.push("sign");
      expect(request.message).toMatchObject({ from: ACCOUNT, nonce: 4n });
      return SIGNATURE;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        events.push("post");
        const body = JSON.parse(String(init?.body)) as {
          transactions: Array<{ chain: number; target: Address; data: Hex; value: string }>;
        };
        expect(body.transactions).toHaveLength(1);
        expect(body.transactions[0]).toMatchObject({ chain: 1, value: "3" });
        expect(body.transactions[0].data).toMatch(/^0x[0-9a-f]+$/);
        return new Response(JSON.stringify(quote()), { status: 200 });
      }),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());

    let response: RelayrPostBundleResponse | undefined;
    await act(async () => {
      response = await result.current.getRelayrTxQuote([REQUEST]);
    });

    expect(response?.bundle_uuid).toBe(BUNDLE_UUID);
    expect(events).toEqual(["switch", "simulate", "nonce", "review", "sign", "post"]);
  });

  it("rejects mismatched senders and same-chain nonce collisions before signing", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());

    await expect(
      result.current.getRelayrTxQuote([
        { ...REQUEST, data: { ...REQUEST.data, from: OTHER_ACCOUNT } },
      ]),
    ).rejects.toThrow(/sender does not match/i);
    await expect(
      result.current.getRelayrTxQuote([
        REQUEST,
        { ...REQUEST, data: { ...REQUEST.data, to: PAYMENT_TARGET } },
      ]),
    ).rejects.toThrow(/same onchain nonce/i);
    expect(reviewer).not.toHaveBeenCalled();
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("does not sign when the account changes during review", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => {
      mocks.account = { ...mocks.account, address: OTHER_ACCOUNT };
      return true;
    });
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());

    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      "Connected account changed",
    );
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("rejects Safe connectors and incomplete Relayr quotes", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 1,
      connector: { id: "safe", name: "Safe" },
    };
    const first = await freshHarness();
    const safe = renderHook(() => first.hooks.useGetRelayrTxQuote());
    await expect(safe.result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /Safe cannot authorize/i,
    );
    safe.unmount();

    mocks.account = {
      address: ACCOUNT,
      chainId: 1,
      connector: { id: "injected", name: "Injected" },
    };
    const second = await freshHarness();
    second.review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ bundle_uuid: "", payment_info: [], per_txn: [], txn_uuids: [] }),
            { status: 200 },
          ),
        ),
    );
    const incomplete = renderHook(() => second.hooks.useGetRelayrTxQuote());
    await expect(incomplete.result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /incomplete quote/i,
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
  });
  it("signs one authorization per destination and posts them in one bundle", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(
          body.transactions.map((transaction: { chain: number }) => transaction.chain),
        ).toEqual([1, 10]);
        expect(body.virtual_nonce_mode).toBe("Disabled");
        return new Response(JSON.stringify({ ...quote(), txn_uuids: ["ethereum", "optimism"] }), {
          status: 200,
        });
      }),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([REQUEST, { ...REQUEST, chainId: 10 }]);
    });
    expect(mocks.signTypedData.mock.calls.map(([request]) => request.domain.chainId)).toEqual([
      1, 10,
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("blocks unsupported networks and untrusted forwarders before authorizing", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([{ ...REQUEST, chainId: 56 as typeof REQUEST.chainId }]),
    ).rejects.toThrow(/direct transaction flow/);
    mocks.readContract.mockResolvedValue(false);
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /does not trust this forwarder/,
    );
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("rejects mixed mainnet and testnet destinations before any authorization", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([REQUEST, { ...REQUEST, chainId: 11155111 }]),
    ).rejects.toThrow(/only mainnets or only testnets/);
    expect(reviewer).not.toHaveBeenCalled();
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a domain from another deployment", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "isTrustedForwarder"
        ? true
        : functionName === "nonces"
          ? 4n
          : ["0x0f", "Juicebox", "1", 1n, TARGET, HASH, []],
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /domain does not match/,
    );
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("retains publication intent when POST may have reached Relayr but its response is lost", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
          kind: "relayr-bundle",
          relayrPaymentStatus: "unfunded",
        });
        throw new Error("connection reset after POST");
      }),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(/connection reset/);
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /already has published authorizations/,
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date((NOW + 48 * 3600) * 1_000));
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /already has published authorizations/,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("blocks a newly selected subset of calls from an unresolved bundle", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...quote(), txn_uuids: ["ethereum", "optimism"] }), {
          status: 200,
        }),
      ),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([REQUEST, { ...REQUEST, chainId: 10 }]);
    });
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /already has published authorizations/,
    );
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "blocks a different operation sharing an unresolved signer and forwarder nonce (legacy activity: %s)",
    async (legacyActivity) => {
      const { review, activity, hooks } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(quote()), { status: 200 })),
      );
      const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
      await act(async () => {
        await result.current.getRelayrTxQuote([{ ...REQUEST, recoveryScope: "metadata:1:4" }]);
      });
      const published = activity.transactionActivitySnapshot().find((item) => item.relayrQuote);
      expect(published?.relayrCallKeys?.some((key) => key.includes("forwarder-nonce:1:"))).toBe(
        true,
      );
      if (legacyActivity) {
        activity.updateTransactionActivity(published!.id, { relayrCallKeys: [] });
      }
      await expect(
        result.current.getRelayrTxQuote([
          { ...REQUEST, recoveryScope: "tokens:1:4", data: { ...REQUEST.data, data: "0x5678" } },
        ]),
      ).rejects.toThrow(/published authorizations/);
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("does not publish signatures if browser recovery storage cannot persist them", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /recovery storage is unavailable/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["not json", "{}", "[null]"])(
    "blocks signing and direct fallback when the saved activity journal is invalid: %s",
    async (corrupt) => {
      const { review, hooks } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      window.localStorage.setItem("revnet:transaction-activities:v1", corrupt);
      const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
      await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
        /storage is unavailable/,
      );
      expect(() =>
        hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, "project-credits:1:4"),
      ).toThrow(/storage is unavailable/);
      expect(mocks.signTypedData).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("revnet:transaction-activities:v1")).toBe(corrupt);
    },
  );

  it("retains a logical launch lock when a retry changes salt or calldata", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("POST response lost")));
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([{ ...REQUEST, recoveryScope: "revnet-launch" }]),
    ).rejects.toThrow(/POST response lost/);
    expect(() => hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, "revnet-launch")).toThrow(
      /previous Relayr launch/,
    );
    await expect(
      result.current.getRelayrTxQuote([
        { ...REQUEST, recoveryScope: "revnet-launch", data: { ...REQUEST.data, data: "0x5678" } },
      ]),
    ).rejects.toThrow(/already has published authorizations/);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
  });

  it.each(["project-metadata:1:4", "project-splits:1:4:123:1"])(
    "keeps changed setter calldata blocked by an unresolved destination scope: %s",
    async (recoveryScope) => {
      const { review, hooks } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("POST response lost")));
      const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
      await expect(
        result.current.getRelayrTxQuote([{ ...REQUEST, recoveryScope }]),
      ).rejects.toThrow(/POST response lost/);
      await expect(
        result.current.getRelayrTxQuote([
          { ...REQUEST, recoveryScope, data: { ...REQUEST.data, data: "0x5678" } },
        ]),
      ).rejects.toThrow(/already has published authorizations/);
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("resumes a persisted unpaid quote after reload without signing or publishing again", async () => {
    const first = await freshHarness();
    first.review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(quote()), { status: 200 })),
    );
    const initial = renderHook(() => first.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await initial.result.current.getRelayrTxQuote([REQUEST]);
    });
    initial.unmount();
    const second = await freshHarness();
    const resumed = renderHook(() => second.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(resumed.result.current.getRelayrTxQuote([REQUEST])).resolves.toMatchObject({
        bundle_uuid: BUNDLE_UUID,
      });
    });
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { target: TARGET },
    { token: TARGET },
    { chain: 11155111 as const },
    { calldata: "0x1234" as Hex },
    { payment_deadline: String(NOW + 601) },
  ])("does not expose an unauthenticated payment option: %j", async (override) => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(quote(payment(override))), { status: 200 })),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /Relayr|quote deadline/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("raw payer publication and durable source guards", () => {
  const deployment = {
    kind: "project-payer" as const,
    projectId: "4",
    beneficiary: ACCOUNT,
    owner: ACCOUNT,
    addToBalance: false,
    memo: "",
    metadata: "0x" as Hex,
    directory: TARGET,
  };
  const raw = {
    ...REQUEST,
    relayrMode: "raw" as const,
    recoveryScope: "payer:1:4",
    expectedDeployment: deployment,
    data: {
      ...REQUEST.data,
      to: JB_PROJECT_PAYER_DEPLOYER,
      value: 0n,
      data: encodeFunctionData({
        abi: jbProjectPayerDeployerAbi,
        functionName: "deployProjectPayer",
        args: [4n, ACCOUNT, "", "0x", false, ACCOUNT],
      }),
    },
  };
  it("reviews and publishes exact canonical payer calldata without a forwarder signature", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(quote()), { status: 200 })),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([raw]);
    });
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    expect(
      mocks.readContract.mock.calls.some(([call]) => call.functionName === "isTrustedForwarder"),
    ).toBe(false);
    const posted = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(posted.transactions[0]).toMatchObject({
      chain: 1,
      target: JB_PROJECT_PAYER_DEPLOYER,
      data: raw.data.data,
      value: "0",
    });
    expect(
      activity.transactionActivitySnapshot()[0].relayrExpectedTransactions?.[0].expectedDeployment,
    ).toEqual(deployment);
  });
  it("retains a raw deployment publication after response loss and rejects changed intent", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("POST response lost")));
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([raw])).rejects.toThrow(/POST response lost/);
    await expect(
      result.current.getRelayrTxQuote([{ ...raw, data: { ...raw.data, data: "0x1234" } }]),
    ).rejects.toThrow(/published authorizations/);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("persists raw source guards and refuses funding when they change after quote review", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(quote()), { status: 200 })),
    );
    mocks.clientCall.mockResolvedValue({ data: "0x01" });
    const source = { address: TARGET, data: "0xabcd" as Hex, expected: "0x01" as Hex };
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([{ ...raw, preconditions: [source] }]);
    });
    expect(
      activity.transactionActivitySnapshot()[0].relayrExpectedTransactions?.[0].preconditions,
    ).toEqual([source]);
    mocks.clientCall.mockResolvedValue({ data: "0x02" });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /reviewed state changed/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("metadata source guards in Relayr", () => {
  const source = {
    chainId: 1,
    projectId: "4",
    directory: PAYMENT_TARGET,
    projects: PAYMENT_TARGET,
    permissions: PAYMENT_TARGET,
    controller: TARGET,
    uri: "ipfs://original",
  };

  it("does not sign when the source URI changes during authorization review", async () => {
    const { hooks, review } = await freshHarness();
    let uri = source.uri;
    const originalRead = mocks.readContract.getMockImplementation()!;
    mocks.readContract.mockImplementation(async (request) =>
      request.functionName === "ownerOf"
        ? ACCOUNT
        : request.functionName === "controllerOf"
          ? TARGET
          : request.functionName === "uriOf"
            ? uri
            : originalRead(request),
    );
    review.registerTransactionReviewHandler(async () => {
      uri = "ipfs://changed";
      return true;
    });
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([{ ...REQUEST, metadataSource: source }]),
    ).rejects.toThrow(/source metadata changed/);
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists and rechecks the source URI before funding an already signed metadata bundle", async () => {
    const { hooks, review, activity } = await freshHarness();
    let uri = source.uri;
    const originalRead = mocks.readContract.getMockImplementation()!;
    mocks.readContract.mockImplementation(async (request) =>
      request.functionName === "ownerOf"
        ? ACCOUNT
        : request.functionName === "controllerOf"
          ? TARGET
          : request.functionName === "uriOf"
            ? uri
            : originalRead(request),
    );
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(quote()), { status: 200 })),
    );
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([{ ...REQUEST, metadataSource: source }]);
    });
    expect(
      activity.transactionActivitySnapshot()[0].relayrExpectedTransactions?.[0].metadataSource,
    ).toEqual(source);
    review.registerTransactionReviewHandler(async () => {
      uri = "ipfs://changed";
      return true;
    });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /source metadata changed/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
});

async function quotedPayment(
  requests: ReviewedRelayrRequest[] = [REQUEST],
  offeredQuote = quote(),
) {
  const harness = await freshHarness();
  harness.review.registerTransactionReviewHandler(async () => true);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(offeredQuote), { status: 200 })),
  );
  const authorization = renderHook(() => harness.hooks.useGetRelayrTxQuote());
  await act(async () => {
    await authorization.result.current.getRelayrTxQuote(requests);
  });
  const send = renderHook(() => harness.hooks.useSendRelayrTx());
  // Stop the automatic destination watcher without entering a timer loop.
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ bundle_uuid: "wrong", transactions: [] }), { status: 200 }),
      ),
  );
  return { ...harness, quote: authorization.result.current.data, result: send.result };
}

describe("reviewed Relayr payment hook", () => {
  it("signs all four testnets once and funds them with one explicitly selected testnet payment", async () => {
    const chainIds = [11155111, 11155420, 84532, 421614] as const;
    const selectedPayment = payment({ chain: 84532 });
    const harness = await quotedPayment(
      chainIds.map((chainId) => ({ ...REQUEST, chainId })),
      {
        ...quote(),
        payment_info: [payment(), payment({ chain: 11155111 }), selectedPayment],
        txn_uuids: chainIds.map((chainId) => `tx-${chainId}`),
      },
    );
    expect(mocks.signTypedData.mock.calls.map(([request]) => request.domain.chainId)).toEqual(
      chainIds,
    );
    expect(harness.quote?.payment_info.map((option) => option.chain)).toEqual([11155111, 84532]);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    await expect(harness.result.current.sendRelayrTx(payment())).rejects.toThrow(/does not belong/);
    await act(async () => {
      await expect(harness.result.current.sendRelayrTx(selectedPayment)).resolves.toBe(HASH);
    });
    expect(mocks.sendTransaction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ account: ACCOUNT, chainId: 84532, to: PAYMENT_TARGET, value: 16n }),
    );
    expect(mocks.getCode).toHaveBeenCalledWith({ address: PAYMENT_TARGET });
    expect(
      harness.activity
        .transactionActivityForHash(HASH)
        ?.relayrExpectedTransactions?.map((transaction) => transaction.chainId),
    ).toEqual(chainIds);
  });

  it("retains an unusable publication when the service offers only mainnet funding for testnets", async () => {
    const { review, hooks, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(quote()), { status: 200 })),
    );
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      authorizer.result.current.getRelayrTxQuote([{ ...REQUEST, chainId: 11155111 }]),
    ).rejects.toThrow(/no funding option/);
    expect(activity.transactionActivitySnapshot()).toEqual([
      expect.objectContaining({ relayrPaymentStatus: "unfunded" }),
    ]);
    await expect(
      authorizer.result.current.getRelayrTxQuote([{ ...REQUEST, chainId: 11155111 }]),
    ).rejects.toThrow(/published authorizations/);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("filters legacy saved testnet quote funding without signing or publishing again", async () => {
    const request = { ...REQUEST, chainId: 11155111 as const };
    const offeredQuote = {
      ...quote(),
      payment_info: [payment(), payment({ chain: 84532 })],
    };
    const initial = await quotedPayment([request], offeredQuote);
    initial.activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrQuote: offeredQuote,
    });
    const resumed = await freshHarness();
    const authorizer = renderHook(() => resumed.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(authorizer.result.current.getRelayrTxQuote([request])).resolves.toMatchObject({
        payment_info: [payment({ chain: 84532 })],
      });
    });
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    const payer = renderHook(() => resumed.hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(/does not belong/);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("isolates persisted testnet fees from returned quote mutations before and after recovery", async () => {
    const request = { ...REQUEST, chainId: 11155111 as const };
    const offeredPayment = payment({ chain: 84532 });
    const initial = await quotedPayment([request], quote(offeredPayment));
    initial.quote!.payment_info[0].amount = "0x100";
    initial.activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      message: "Still awaiting the original reviewed payment.",
    });
    expect(initial.activity.transactionActivitySnapshot()[0].relayrQuote?.payment_info).toEqual([
      offeredPayment,
    ]);

    const resumed = await freshHarness();
    const authorizer = renderHook(() => resumed.hooks.useGetRelayrTxQuote());
    await act(async () => {
      const restored = await authorizer.result.current.getRelayrTxQuote([request]);
      expect(restored.payment_info).toEqual([offeredPayment]);
      restored.payment_info[0].amount = "0x200";
    });
    resumed.activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      message: "The restored fee remains unchanged.",
    });
    expect(resumed.activity.transactionActivitySnapshot()[0].relayrQuote?.payment_info).toEqual([
      offeredPayment,
    ]);
    const payer = renderHook(() => resumed.hooks.useSendRelayrTx());
    await expect(
      payer.result.current.sendRelayrTx({ ...offeredPayment, amount: "0x200" }),
    ).rejects.toThrow(/does not belong/);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("reviews the exact selected funding chain and persists its signed destination calls", async () => {
    const { review, activity, result } = await quotedPayment();
    review.registerTransactionReviewHandler(async (request) => {
      expect(request).toMatchObject({ kind: "transaction", title: "Review Relayr payment" });
      expect(request.calls[0]).toMatchObject({
        chainId: 1,
        from: ACCOUNT,
        to: PAYMENT_TARGET,
        value: 16n,
        data: payment().calldata,
      });
      return true;
    });
    await act(async () => {
      await expect(result.current.sendRelayrTx(payment())).resolves.toBe(HASH);
    });
    expect(mocks.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ account: ACCOUNT, chainId: 1, to: PAYMENT_TARGET, value: 16n }),
    );
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      kind: "relayr-bundle",
      relayrPaymentStatus: "confirmed",
      relayrExpectedTransactions: [
        expect.objectContaining({ chainId: 1, transactionUuid: "tx-reviewed" }),
      ],
    });
  });

  it("rejects payments that were not returned by an authorized quote", async () => {
    const { hooks } = await freshHarness();
    const { result } = renderHook(() => hooks.useSendRelayrTx());
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /does not belong to a reviewed Relayr quote/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([1, 11155111] as const)(
    "rejects edited quote fields and unrecognized runtime on %s",
    async (chainId) => {
      const { result } = await quotedPayment(
        [{ ...REQUEST, chainId }],
        quote(payment({ chain: chainId })),
      );
      await expect(
        result.current.sendRelayrTx(payment({ chain: chainId, amount: "0x100" })),
      ).rejects.toThrow(/does not belong/);
      mocks.getCode.mockResolvedValue("0x00");
      await expect(result.current.sendRelayrTx(payment({ chain: chainId }))).rejects.toThrow(
        /code is not recognized/,
      );
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
    },
  );

  it("rejects account or chain changes before funding submission", async () => {
    const { review, result } = await quotedPayment();
    review.registerTransactionReviewHandler(async () => {
      mocks.account.address = OTHER_ACCOUNT;
      return true;
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /account or chain changed/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("revalidates the exact signed destination after funding review and never pays a consumed nonce or changed destination", async () => {
    const { review, result, activity } = await quotedPayment();
    review.registerTransactionReviewHandler(async () => {
      mocks.clientCall.mockRejectedValueOnce(
        new Error("signed forwarder request reverted: nonce consumed"),
      );
      return true;
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/nonce consumed/);
    const expected = activity.transactionActivitySnapshot()[0].relayrExpectedTransactions![0];
    expect(mocks.clientCall).toHaveBeenLastCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        to: expected.target,
        data: expected.data,
        value: 3n,
        gas: BigInt(expected.gas!),
        stateOverride: [expect.objectContaining({ address: ACCOUNT })],
      }),
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(activity.transactionActivitySnapshot()[0].relayrPaymentStatus).toBe("unfunded");
  });

  it("rejects a quote that expires while the review sits open", async () => {
    const { review, result } = await quotedPayment();
    review.registerTransactionReviewHandler(async () => {
      vi.setSystemTime(new Date((NOW + 700) * 1_000));
      return true;
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/expired/);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("routes a switched Safe connector back to its proposal flow", async () => {
    const { result } = await quotedPayment();
    mocks.account.connector = { id: "safe", name: "Safe" };
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/Safe proposal flow/);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("retains uncertain funding and blocks duplicate funding and newly signed copies", async () => {
    const { activity, hooks, result } = await quotedPayment();
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("RPC unavailable"));
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /confirmation is uncertain/,
    );
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "pending",
      relayrPaymentStatus: "submitted",
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /already has a submitted payment/,
    );
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(authorizer.result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /already has a submitted payment/,
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("blocks a second funding option after the first has been paid", async () => {
    const harness = await freshHarness();
    harness.review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...quote(), payment_info: [payment(), payment({ chain: 10 })] }),
            { status: 200 },
          ),
        ),
    );
    const authorizer = renderHook(() => harness.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([REQUEST]);
    });
    const payer = renderHook(() => harness.hooks.useSendRelayrTx());
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("RPC unavailable"));
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(/uncertain/);
    await expect(payer.result.current.sendRelayrTx(payment({ chain: 10 }))).rejects.toThrow(
      /already has a submitted payment/,
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("retains a lock when wallet broadcast fails ambiguously, but permits explicit rejection retry", async () => {
    const { activity, result } = await quotedPayment();
    mocks.sendTransaction.mockRejectedValueOnce({ code: 4001 });
    await expect(result.current.sendRelayrTx(payment())).rejects.toEqual({ code: 4001 });
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrPaymentStatus: "unfunded",
    });
    mocks.sendTransaction.mockRejectedValueOnce(new Error("connection lost"));
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow("connection lost");
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/uncertain wallet result/);
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not accept a funding receipt for another payment", async () => {
    const { result } = await quotedPayment();
    mocks.getTransaction.mockResolvedValue(onchain(TARGET, "0x"));
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /confirmation is uncertain/,
    );
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /already has a submitted payment/,
    );
  });
});
