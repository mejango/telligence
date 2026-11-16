import { AccountActivity } from "@/app/account/[id]/components/AccountActivity";
import type { TransactionActivity } from "@/lib/transaction-activity";
import { erc2771ForwarderAbi, jbContractAddress } from "@bananapus/nana-sdk-core";
import {
  checkedItLabel,
  HELD_HASH_MISMATCH_LINE,
  HELD_HASH_UNVERIFIED_LINE,
  SAVED_ATTEMPT_CHECK_LINE,
  SAVED_ATTEMPT_CHECK_WARNING,
  SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL,
} from "@bananapus/nana-sdk-core/review";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { encodeFunctionData } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"aa".repeat(32)}` as const;
const mocks = vi.hoisted(() => ({
  activities: [] as TransactionActivity[],
  indexed: [] as { id: string; txHash: string; chainId: number }[],
  waitForRelayrBundle: vi.fn(async () => undefined),
  checkRelayrSession: vi.fn(async () => undefined),
  discardRelayrSession: vi.fn(),
  relayrSessionCheck: vi.fn(),
  client: undefined as unknown,
  retireCheckedRelayrSession: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/hooks/useReviewedRelayr", () => ({
  waitForRelayrBundle: mocks.waitForRelayrBundle,
  checkRelayrSession: mocks.checkRelayrSession,
  discardRelayrSession: mocks.discardRelayrSession,
  relayrSessionCheck: mocks.relayrSessionCheck,
  retireCheckedRelayrSession: mocks.retireCheckedRelayrSession,
}));
vi.mock("wagmi", () => ({ usePublicClient: () => mocks.client }));
vi.mock("@/hooks/useViewedAccount", () => ({ useViewedAccount: () => ({ address: ACCOUNT }) }));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteAccountActivity: () => ({ data: {}, isLoading: false, isError: false }),
}));
vi.mock("@/lib/bendystraw/accountActivity", () => ({ mergeAccountActivity: () => mocks.indexed }));
vi.mock("@/lib/transaction-activity", () => ({
  useTransactionActivities: () => mocks.activities,
  dismissTransactionActivity: mocks.dismiss,
}));
vi.mock("@/app/[slug]/components/ActivityFeed/mapActivityEvents", () => ({
  mapActivityEvents: () => [],
}));
vi.mock("@/app/[slug]/components/ActivityFeed/ActivityItem", () => ({
  ActivityItemRow: () => null,
}));
vi.mock("@/components/ProfilesContext", () => ({
  ProfilesProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children }: PropsWithChildren) => children,
}));

/** Renders the account's activity once its own pending-writes panel has loaded. */
async function renderActivity() {
  const rendered = render(<AccountActivity address={ACCOUNT} />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return rendered;
}

function activity(overrides: Partial<TransactionActivity> = {}): TransactionActivity {
  return {
    id: "relayr:bundle",
    kind: "relayr-bundle",
    account: ACCOUNT,
    title: "Update recipients",
    message: "Waiting for destination confirmation",
    status: "pending",
    bundleUuid: "bundle-1",
    hash: HASH,
    relayrPaymentStatus: "confirmed",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.client = undefined;
  mocks.activities = [];
  mocks.indexed = [];
  mocks.checkRelayrSession.mockClear();
  mocks.discardRelayrSession.mockClear();
});

/** One forward request on Base, signed at the forwarder nonce 4. */
function signedRequest(): Pick<TransactionActivity, "relayrExpectedTransactions" | "relayrNonces"> {
  const forwarder = jbContractAddress["6"].ERC2771Forwarder[8453]!;
  return {
    relayrExpectedTransactions: [
      {
        chainId: 8453,
        target: forwarder,
        data: encodeFunctionData({
          abi: erc2771ForwarderAbi,
          functionName: "execute",
          args: [
            {
              from: ACCOUNT,
              to: ACCOUNT,
              value: 0n,
              gas: 100_000n,
              deadline: 1_900_000_000,
              data: "0x1234",
              signature: `0x${"12".repeat(65)}`,
            },
          ],
        }),
        value: "0",
        transactionUuid: "11111111-1111-4111-8111-111111111111",
      },
    ],
    relayrNonces: ["4"],
  };
}

describe("account Relayr session rules (ruling R114 (e))", () => {
  it("renders legacy titles and recovery messages without rewriting the saved evidence", async () => {
    const saved = Object.freeze(
      activity({
        title: "Relayr multi-chain bundle",
        message:
          "Relayr funding is being submitted. Do not pay again while the wallet result is uncertain.",
      }),
    );
    mocks.activities = [saved];
    const { container } = await renderActivity();
    expect(screen.getByText("Multi-chain bundle")).toBeVisible();
    expect(
      screen.getByText(
        "Funding is being submitted. Do not pay again while the wallet result is uncertain.",
      ),
    ).toBeVisible();
    expect(container).not.toHaveTextContent(/Relayr/i);
    expect(saved.title).toBe("Relayr multi-chain bundle");
    expect(saved.message).toContain("Relayr funding is being submitted");
  });

  it("checks an unpaid session's signatures", async () => {
    mocks.activities = [
      activity({ relayrPaymentStatus: "unfunded", hash: undefined, ...signedRequest() }),
    ];
    await renderActivity();
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    expect(mocks.checkRelayrSession).toHaveBeenCalledExactlyOnceWith("relayr:bundle");
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("offers Discard with its line for a session marked for it, and no other check", async () => {
    const line = "This action's earlier signatures expired without running.";
    mocks.activities = [
      activity({
        relayrPaymentStatus: "unfunded",
        hash: undefined,
        status: "failed",
        manualVerificationRequired: true,
        relayrDiscardable: "expired",
        message: line,
        ...signedRequest(),
      }),
    ];
    await renderActivity();
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check signatures" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(mocks.discardRelayrSession).toHaveBeenCalledExactlyOnceWith("relayr:bundle");
  });

  it("never offers Discard on a completed bundle", async () => {
    mocks.activities = [
      activity({
        status: "success",
        manualVerificationRequired: false,
        relayrDiscardable: "ran",
        ...signedRequest(),
      }),
    ];
    await renderActivity();
    expect(screen.getByText("Update recipients")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("never offers Discard on a session a new quote replaced", async () => {
    mocks.activities = [
      activity({
        status: "failed",
        manualVerificationRequired: false,
        relayrPaymentStatus: "expired",
        relayrDiscardable: "expired",
        hash: undefined,
        message: "This unpaid Relayr quote was replaced by a new one. Nothing was paid.",
        ...signedRequest(),
      }),
    ];
    await renderActivity();
    expect(screen.getByText("Update recipients")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("checks no signatures it can't classify, such as a raw call's", async () => {
    mocks.activities = [
      activity({
        relayrPaymentStatus: "unfunded",
        hash: undefined,
        relayrExpectedTransactions: [
          { chainId: 8453, target: ACCOUNT, data: "0x1234", value: "0", transactionUuid: "" },
        ],
      }),
    ];
    await renderActivity();
    expect(screen.queryByRole("button", { name: "Check signatures" })).not.toBeInTheDocument();
  });
});

describe("a saved session its check can't show", () => {
  const CHECK = {
    status: "check" as const,
    reason: "malformed recovery history",
    line: SAVED_ATTEMPT_CHECK_LINE,
    warning: SAVED_ATTEMPT_CHECK_WARNING,
    evidence: "{}",
  };

  it("offers the SDK's one check instead of a dead end, and the warned continue only once refused", async () => {
    mocks.activities = [
      activity({ relayrPaymentStatus: "unfunded", hash: undefined, ...signedRequest() }),
    ];
    mocks.checkRelayrSession.mockRejectedValueOnce(new Error("malformed recovery history"));
    mocks.relayrSessionCheck.mockResolvedValue(CHECK);
    mocks.retireCheckedRelayrSession
      .mockResolvedValue({ retired: true, durable: true })
      .mockResolvedValueOnce({ retired: false, reason: "unreadable" });
    await renderActivity();

    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    expect(await screen.findByText(SAVED_ATTEMPT_CHECK_LINE)).toBeVisible();
    expect(screen.getByText(SAVED_ATTEMPT_CHECK_WARNING)).toBeVisible();
    expect(screen.queryByRole("button", { name: SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: checkedItLabel() }));
    await waitFor(() =>
      expect(mocks.retireCheckedRelayrSession).toHaveBeenCalledWith(
        "relayr:bundle",
        CHECK,
        undefined,
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL }),
    );
    expect(mocks.retireCheckedRelayrSession).toHaveBeenLastCalledWith(
      "relayr:bundle",
      CHECK,
      "unreadable",
    );
  });
});

describe("account Relayr recovery controls", () => {
  it.each(["unfunded", "reverted"] as const)(
    "does not offer a bundle check for %s payment",
    async (relayrPaymentStatus) => {
      mocks.activities = [activity({ relayrPaymentStatus })];
      await renderActivity();
      expect(screen.getByText("Update recipients")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Check bundle" })).not.toBeInTheDocument();
    },
  );

  it.each([
    { status: "failed" as const, manualVerificationRequired: false },
    { status: "success" as const, manualVerificationRequired: true },
  ])("offers verification for funded $status bundles", async (overrides) => {
    mocks.activities = [activity(overrides)];
    await renderActivity();
    fireEvent.click(screen.getByRole("button", { name: "Check bundle" }));
    expect(mocks.waitForRelayrBundle).toHaveBeenCalledExactlyOnceWith("bundle-1");
  });

  it("keeps an unresolved bundle visible when its payment is already indexed", async () => {
    mocks.activities = [activity({ status: "failed", manualVerificationRequired: true })];
    mocks.indexed = [{ id: "indexed-payment", txHash: HASH, chainId: 8453 }];
    await renderActivity();
    expect(screen.getByRole("button", { name: "Check bundle" })).toBeInTheDocument();
  });
});

describe("a Safe proposal whose result can't be confirmed here", () => {
  it("offers its account a Dismiss, and no other proposal one", async () => {
    const proposal = {
      kind: "safe" as const,
      status: "safe-proposed" as const,
      bundleUuid: undefined,
      relayrPaymentStatus: undefined,
    };
    mocks.activities = [
      activity({
        ...proposal,
        id: "safe:unconfirmed",
        title: "Make the market",
        message:
          "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
        safeResultUnconfirmed: true,
      }),
      activity({ ...proposal, id: "safe:pending", title: "Set the split" }),
    ];
    await renderActivity();

    const dismiss = screen.getAllByRole("button", { name: "Dismiss" });
    expect(dismiss).toHaveLength(1);
    fireEvent.click(dismiss[0]!);
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith("safe:unconfirmed");
  });

  it.each(["hash", "executionHash"] as const)(
    "stays, with its Dismiss, once its %s is indexed",
    async (field) => {
      mocks.activities = [
        activity({
          id: "safe:unconfirmed",
          kind: "safe",
          status: "safe-proposed",
          bundleUuid: undefined,
          relayrPaymentStatus: undefined,
          title: "Make the market",
          hash: `0x${"bb".repeat(32)}`,
          [field]: HASH,
          safeResultUnconfirmed: true,
        }),
      ];
      mocks.indexed = [{ id: "indexed-execution", txHash: HASH, chainId: 8453 }];
      await renderActivity();

      expect(screen.getByText("Make the market")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith("safe:unconfirmed");
    },
  );
});

describe("the account's held writes", () => {
  it("shows every write the SDK holds for the account, with its line", async () => {
    const node = {
      getChainId: async () => 8453,
      getBlockNumber: async () => 100n,
      getBlock: async () => ({ number: 100n, hash: `0x${"bb".repeat(32)}` }),
      getTransactionCount: async () => 3,
      getTransaction: async () => {
        throw new Error("not found");
      },
      getTransactionReceipt: async () => {
        throw new Error("not found");
      },
      request: async () => null,
    };
    const { writeHolds } = await import("@/lib/write-hold");
    // The wallet never answered: the hold keeps the write, with no hash.
    await writeHolds
      .open({
        chainId: 8453,
        account: ACCOUNT,
        safe: false,
        call: { to: ACCOUNT, data: "0x1234", value: 0n },
      })
      .send(node as never, async (gate) => {
        await gate.beforeSend();
        throw new Error("Wallet transport timed out");
      })
      .catch(() => undefined);
    mocks.client = node;
    await renderActivity();
    expect(
      await screen.findByText("Your earlier transaction hasn't confirmed yet. Check your wallet."),
    ).toBeVisible();
  });

  it("takes the hash of a held write whose wallet reply was lost, attached only if it is that send", async () => {
    /** The node's word on the given hash: unread until it indexes it. */
    let given: object | null = null;
    let rateLimited = false;
    const node = {
      getChainId: async () => 8453,
      getBlockNumber: async () => 100n,
      getBlock: async () => ({ number: 100n, hash: `0x${"bb".repeat(32)}` }),
      getTransactionCount: async () => 3,
      getTransaction: async () => {
        if (rateLimited)
          throw Object.assign(new Error("HTTP request failed. Status: 429"), { status: 429 });
        if (given) return given;
        throw new Error("not found");
      },
      getTransactionReceipt: async () => {
        throw new Error("not found");
      },
      request: async () => null,
    };
    const { writeHolds } = await import("@/lib/write-hold");
    await writeHolds
      .open({
        chainId: 8453,
        account: ACCOUNT,
        safe: false,
        call: { to: ACCOUNT, data: "0x5678", value: 0n },
      })
      .send(node as never, async (gate) => {
        await gate.beforeSend();
        throw new Error("Wallet transport timed out");
      })
      .catch(() => undefined);
    mocks.client = node;
    await renderActivity();
    const [field] = await screen.findAllByLabelText(
      "Transaction hash, if the wallet reply was lost",
    );
    const check = () =>
      fireEvent.click(field!.parentElement!.querySelector("button") as HTMLButtonElement);
    fireEvent.change(field!, { target: { value: "0x1234" } });
    check();
    expect(await screen.findByText("Enter a complete transaction hash.")).toBeVisible();
    const other = `0x${"cd".repeat(32)}`;
    fireEvent.change(field!, { target: { value: other } });
    // Not readable yet: a retry, never a mismatch.
    check();
    expect(await screen.findByText(HELD_HASH_UNVERIFIED_LINE)).toBeVisible();
    expect(screen.queryByText(HELD_HASH_MISMATCH_LINE)).toBeNull();
    // Read, and another call: a mismatch.
    given = {
      hash: other,
      from: ACCOUNT,
      to: ACCOUNT,
      input: "0x9999",
      value: 0n,
      nonce: 3,
      chainId: 8453,
      blockNumber: null,
    };
    // Rate limited: still a retry, never a mismatch.
    rateLimited = true;
    check();
    await waitFor(() => expect(screen.queryByText(HELD_HASH_UNVERIFIED_LINE)).toBeNull());
    expect(await screen.findByText(HELD_HASH_UNVERIFIED_LINE)).toBeVisible();
    expect(screen.queryByText(HELD_HASH_MISMATCH_LINE)).toBeNull();
    rateLimited = false;
    check();
    expect(await screen.findByText(HELD_HASH_MISMATCH_LINE)).toBeVisible();
  });
});
