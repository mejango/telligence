import {
  LaunchCheckNotice,
  LaunchConfirmingNotice,
  LaunchedNotice,
} from "@/app/create/form/LaunchedNotice";
import {
  discardLaunch,
  launchAttemptOf,
  launchConfigHash,
  launchConfigOf,
  launchInputOf,
  launchKeyOf,
  launchNamespacesOf,
  retrySaltOf,
  saveLaunchAttempt,
  savedLaunchAt,
  savedLaunchKeys,
} from "@/app/create/helpers/launchIntent";
import { recoverLaunchAt } from "@/app/create/helpers/launchRecovery";
import { legacyIntents } from "@/lib/legacy-intents";
import { savedAttempts, writeHolds } from "@/lib/write-hold";
import {
  SAVED_ATTEMPT_CHECK_LINE,
  SAVED_ATTEMPT_CHECK_WARNING,
  SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL,
  SAVED_ATTEMPT_UNREADABLE_LINE,
  checkedItLabel,
  launchIntent as sdkLaunchIntent,
  type SavedAttemptCheck,
} from "@bananapus/nana-sdk-core/review";
import { resetWriteHoldsForTests } from "@bananapus/nana-sdk-core/testing";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The launch's SDK intent, from the form as the page builds it. */
const launchIntent = (form: unknown) =>
  sdkLaunchIntent({ chainId: 1, account: ACCOUNT, config: launchConfigOf(form) });

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";
const DEPLOYER = "0x0000000000000000000000000000000000001000";
const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const SENT = `0x${"12".repeat(32)}` as const;
const BLOCK = `0x${"bb".repeat(32)}` as const;
const config = { name: "Rev" };
const key = () => launchKeyOf(ACCOUNT, 1, config);
const namespaces = () => launchNamespacesOf(1, ACCOUNT, config);
/** The launch call as the hold recorded it. */
const CALL = { to: DEPLOYER, data: "0x1234", value: 0n } as const;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  resetWriteHoldsForTests();
  vi.restoreAllMocks();
});

describe("a launch's intent", () => {
  it("is the user's config alone, whatever order its fields are in", () => {
    expect(launchIntent({ name: "Rev", stages: [{ price: "1" }] })).toEqual(
      launchIntent({ stages: [{ price: "1" }], name: "Rev" }),
    );
    expect(launchIntent({ name: "Rev" })).not.toEqual(launchIntent({ name: "Rev2" }));
  });

  it("is held by its SDK intent and the namespace the main-era build held it by", () => {
    expect(namespaces()).toEqual([
      launchIntent(config),
      ...legacyIntents.launch(launchConfigHash(config)),
    ]);
  });
});

const deployedBy = (deploySalt: string, transactionHash: string = SENT, caller = ACCOUNT) => ({
  removed: false,
  transactionHash,
  args: { revnetId: 42n, configuration: { description: { salt: deploySalt } }, caller },
});

/**
 * A chain that holds `SENT` as the launch (`mined`), with its receipt and block logs; anything else
 * is unknown. Its event scan fails unless `scan` names what it returns.
 */
function chain({
  mined = false,
  status = "success" as "success" | "reverted",
  blockLogs = [] as unknown[],
  scan = new Error("RPC down") as unknown[] | Error,
} = {}) {
  const transaction = {
    hash: SENT,
    from: ACCOUNT,
    to: DEPLOYER,
    input: CALL.data,
    value: 0n,
    nonce: 3,
    blockNumber: 9n,
    blockHash: BLOCK,
    transactionIndex: 0,
    chainId: 1,
  };
  const receipt = {
    status,
    transactionHash: SENT,
    from: ACCOUNT,
    to: DEPLOYER,
    blockNumber: 9n,
    blockHash: BLOCK,
    transactionIndex: 0,
    logs: [],
  };
  return {
    getChainId: vi.fn(async () => 1),
    getBlockNumber: vi.fn(async () => 1_200n),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({
      number: blockNumber ?? 1_200n,
      hash: BLOCK,
    })),
    getTransactionCount: vi.fn(async () => (mined ? 4 : 3)),
    getTransaction: vi.fn(async ({ hash }: { hash: string }) => {
      if (!mined || hash !== SENT) throw new Error("not found");
      return transaction;
    }),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => {
      if (!mined || hash !== SENT) throw new Error("not found");
      return receipt;
    }),
    getLogs: vi.fn(async (args: { blockHash?: string }) => {
      if (args.blockHash) return blockLogs;
      if (scan instanceof Error) throw scan;
      return scan;
    }),
    request: vi.fn(async () => null),
  };
}

/** The journal the page writes once the hold reserved the wallet. */
const save = (attempt: { fromBlock?: bigint; before?: `0x${string}`[] } = { fromBlock: 1_000n }) =>
  saveLaunchAttempt(key(), { salt: salt(7), namespaces: namespaces(), before: [], ...attempt });

/** The hold of the launch under `namespace`, sent once: its wallet returned SENT, or no reply. */
async function sentUnder(
  namespace: string,
  client: ReturnType<typeof chain>,
  reply: "hash" | "lost" = "hash",
) {
  const hold = writeHolds.open({
    chainId: 1,
    account: ACCOUNT,
    safe: false,
    namespace,
    call: CALL,
  });
  await hold
    .send(client as never, async (gate) => {
      await gate.beforeSend();
      if (reply === "lost") throw new Error("Wallet transport timed out");
      gate.afterSubmit(SENT);
    })
    .catch(() => undefined);
  return hold;
}

const recover = (client: object, forcing?: () => boolean) =>
  recoverLaunchAt(key(), ACCOUNT, client as never, namespaces(), forcing);

describe("recovering a saved launch through the SDK: held, done, check or none", () => {
  it("has nothing to recover with no saved launch", async () => {
    await expect(recover(chain())).resolves.toBeUndefined();
  });

  it("leaves a launch the hold still holds to its hold, with its line", async () => {
    save();
    const client = chain();
    await sentUnder(namespaces()[0]!, client);
    await expect(recover(client)).resolves.toMatchObject({ kind: "held" });
    expect(savedLaunchAt(key())).toMatchObject({ salt: salt(7) });
  });

  it("follows a success the hold settled while the page was closed: the revnet, never a second send", async () => {
    save();
    const sending = chain();
    await sentUnder(namespaces()[0]!, sending);
    const settled = chain({ mined: true, blockLogs: [deployedBy(salt(7))] });
    await expect(recover(settled)).resolves.toEqual({
      kind: "launched",
      chainId: 1,
      revnetId: 42n,
    });
    // Followed and retired: the next launch of this config is a new one.
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it.each([
    ["its event can't be found in its block", { blockLogs: [] }],
    ["its event has another salt", { blockLogs: [deployedBy(salt(8))] }],
    [
      "its event is another transaction's",
      { blockLogs: [deployedBy(salt(7), `0x${"56".repeat(32)}`)] },
    ],
  ])(
    "journals a settled success whose revnet can't be read (%s) and only follows it",
    async (_case, logs) => {
      save();
      await sentUnder(namespaces()[0]!, chain());
      const shown = await recover(chain({ mined: true, ...logs }));
      expect(shown).toMatchObject({ kind: "confirming" });
      expect(savedLaunchAt(key())).toMatchObject({ settled: { result: "success", hash: SENT } });
      // Rule E: no check or exit retires a success the journal recorded.
      if (shown?.kind !== "confirming") throw new Error("unreachable");
      await expect(shown.attempt.confirmRetirable()).resolves.toBe(false);
      expect(discardLaunch(shown.attempt)).toBe(false);
    },
  );

  it("finds a launch with no hold record by its exact salt", async () => {
    save();
    await expect(recover(chain({ scan: [deployedBy(salt(7), SENT)] }))).resolves.toEqual({
      kind: "launched",
      chainId: 1,
      revnetId: 42n,
    });
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it.each([
    ["the scan fails", { scan: new Error("RPC down") }],
    ["the scan finds nothing", { scan: [] }],
    ["the scan finds another salt", { scan: [deployedBy(salt(8))] }],
  ])("requires a check when %s, keeping the journal", async (_case, scanned) => {
    save();
    await expect(recover(chain(scanned))).resolves.toMatchObject({
      kind: "check",
      outcome: { line: SAVED_ATTEMPT_CHECK_LINE, warning: SAVED_ATTEMPT_CHECK_WARNING },
    });
    expect(savedLaunchAt(key())).toMatchObject({ salt: salt(7) });
  });

  it("requires a check when no sent block was saved", async () => {
    save({});
    await expect(recover(chain({ scan: [deployedBy(salt(7))] }))).resolves.toMatchObject({
      kind: "check",
    });
  });

  it("retires the attempt only on the user's check, which the journal re-reads first", async () => {
    save();
    const shown = await recover(chain({ scan: [] }));
    if (shown?.kind !== "check") throw new Error("expected a check");
    await expect(shown.attempt.confirmRetirable()).resolves.toBe(true);
    await expect(
      savedAttempts.retire(shown.attempt, { by: "check", outcome: shown.outcome }),
    ).resolves.toMatchObject({ retired: true });
    // Retired for every reload: nothing more to recover, and the journal goes.
    await expect(recover(chain({ scan: [] }))).resolves.toBeUndefined();
    expect(savedLaunchAt(key())).toBeUndefined();
    // Its retry keeps the salt, so if it landed after all the retry reverts; journaling the
    // retry hands the salt to its journal.
    expect(retrySaltOf(key())).toBe(salt(7));
    save();
    expect(retrySaltOf(key())).toBeUndefined();
  });

  it("refuses a stale check once another tab's newer attempt took the journal", async () => {
    save();
    const shown = await recover(chain({ scan: [] }));
    if (shown?.kind !== "check") throw new Error("expected a check");
    saveLaunchAttempt(key(), { salt: salt(8), namespaces: namespaces(), before: [] });
    await expect(shown.attempt.confirmRetirable()).resolves.toBe(false);
    await expect(
      savedAttempts.retire(shown.attempt, { by: "check", outcome: shown.outcome }),
    ).resolves.toMatchObject({ retired: false });
    expect(discardLaunch(shown.attempt)).toBe(false);
    expect(savedLaunchAt(key())).toMatchObject({ salt: salt(8) });
  });

  it("retires an attempt the SDK dropped on a definite wallet rejection, with no check", async () => {
    save();
    const client = chain();
    const hold = writeHolds.open({
      chainId: 1,
      account: ACCOUNT,
      safe: false,
      namespace: namespaces()[0]!,
      call: CALL,
    });
    await hold
      .send(client as never, async (gate) => {
        await gate.beforeSend();
        gate.onRejected();
        throw new Error("User rejected");
      })
      .catch(() => undefined);
    await expect(recover(client)).resolves.toBeUndefined();
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it("reads at most 500 blocks per request and caps the range", async () => {
    save({ fromBlock: 0n });
    const ranges: [bigint, bigint][] = [];
    const client = {
      ...chain(),
      getBlockNumber: vi.fn(async () => 1_000_000n),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      }),
    };
    await expect(recover(client)).resolves.toMatchObject({ kind: "check" });
    expect(ranges.every(([from, to]) => to - from + 1n <= 500n)).toBe(true);
    expect(ranges.reduce((sum, [from, to]) => sum + (to - from + 1n), 0n)).toBeLessThanOrEqual(
      50_000n,
    );
  });
});

describe("a main-era saved launch", () => {
  it("is held by the attempt that build left under its launch namespace", async () => {
    // That build saved only the salt and the block; the wallet returned a hash, then the page closed.
    window.localStorage.setItem(key(), JSON.stringify({ salt: salt(7), fromBlock: "1000" }));
    const client = chain();
    await sentUnder(legacyIntents.launch(launchConfigHash(config))[0]!, client);
    await expect(recoverLaunchAt(key(), ACCOUNT, client as never)).resolves.toMatchObject({
      kind: "held",
    });
  });

  it("requires a check when that build left no hold and the chain can't be scanned", async () => {
    window.localStorage.setItem(key(), JSON.stringify({ salt: salt(7), fromBlock: "1000" }));
    await expect(recoverLaunchAt(key(), ACCOUNT, chain() as never)).resolves.toMatchObject({
      kind: "check",
    });
  });
});

describe("a journal that can't be read", () => {
  const unreadable = () =>
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, name) {
      if (name === key()) throw new Error("SecurityError");
      return Object.getPrototypeOf(this) && null;
    });

  it("throws the SDK's unreadable line, never reading as absent", () => {
    window.localStorage.setItem(key(), "{not json");
    expect(() => savedLaunchAt(key())).toThrow(SAVED_ATTEMPT_UNREADABLE_LINE);
  });

  it("is recovered as a check, and its check is refused until the warned exit", async () => {
    window.localStorage.setItem(key(), "{not json");
    let forcing = false;
    const shown = await recover(chain({ scan: [] }), () => forcing);
    if (shown?.kind !== "check") throw new Error("expected a check");
    await expect(
      savedAttempts.retire(shown.attempt, { by: "check", outcome: shown.outcome }),
    ).resolves.toMatchObject({ retired: false });
    expect(window.localStorage.getItem(key())).toBe("{not json");
    // The warned "I checked my wallet. Continue anyway" alone retires it.
    forcing = true;
    await expect(
      savedAttempts.retire(shown.attempt, {
        by: "check",
        outcome: shown.outcome,
        force: "unreadable",
      }),
    ).resolves.toMatchObject({ retired: true });
    expect(discardLaunch(shown.attempt)).toBe(true);
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it("never counts storage that throws as released", async () => {
    save();
    const read = unreadable();
    const attempt = launchAttemptOf(key(), ACCOUNT, chain() as never, namespaces());
    await expect(attempt.confirmRetirable()).resolves.toBe(false);
    read.mockRestore();
  });
});

describe("the saved launches of an account", () => {
  it("are listed by key, each with its own chain", () => {
    save();
    saveLaunchAttempt(launchKeyOf(ACCOUNT, 10, config), {
      salt: salt(8),
      namespaces: [],
      before: [],
    });
    expect(savedLaunchKeys(ACCOUNT).sort()).toEqual(
      [key(), launchKeyOf(ACCOUNT, 10, config)].sort(),
    );
    expect(savedLaunchKeys("0x000000000000000000000000000000000000bEEF")).toEqual([]);
  });
});

describe("the launch notices", () => {
  const check = {
    status: "check",
    reason: "",
    line: SAVED_ATTEMPT_CHECK_LINE,
    warning: SAVED_ATTEMPT_CHECK_WARNING,
    evidence: "",
  } satisfies SavedAttemptCheck;

  it("says the revnet is already launched and links to it", () => {
    render(<LaunchedNotice chainId={11155111} revnetId={42n} />);
    expect(screen.getByText(/This revnet is already launched/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/sep:42");
  });

  it("offers a launch that went through only a fresh look, never a discard", () => {
    const onCheckAgain = vi.fn();
    render(<LaunchConfirmingNotice onCheckAgain={onCheckAgain} />);
    expect(screen.queryByRole("button", { name: /I checked it/ })).toBeNull();
    screen.getByRole("button", { name: "Check again" }).click();
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });

  it("shows the SDK's check with its one action, and the warned continue only once refused", () => {
    const onChecked = vi.fn();
    const onContinueAnyway = vi.fn();
    const view = render(
      <LaunchCheckNotice
        outcome={check}
        unreadable={false}
        onChecked={onChecked}
        onContinueAnyway={onContinueAnyway}
      />,
    );
    expect(screen.getByText(SAVED_ATTEMPT_CHECK_LINE)).toBeVisible();
    expect(screen.getByText(SAVED_ATTEMPT_CHECK_WARNING)).toBeVisible();
    expect(screen.queryByRole("button", { name: SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL })).toBeNull();
    screen.getByRole("button", { name: checkedItLabel("Launch again") }).click();
    expect(onChecked).toHaveBeenCalledOnce();

    view.rerender(
      <LaunchCheckNotice
        outcome={check}
        unreadable
        onChecked={onChecked}
        onContinueAnyway={onContinueAnyway}
      />,
    );
    expect(screen.getByText(SAVED_ATTEMPT_UNREADABLE_LINE)).toBeVisible();
    screen.getByRole("button", { name: SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL }).click();
    expect(onContinueAnyway).toHaveBeenCalledOnce();
  });
});

describe("a launch's frozen input", () => {
  it("keeps the intent and key of the form as submitted, whatever metadata refreshes later", () => {
    const form = { name: "Rev", customReserveAsset: { symbol: "USDC" } };
    const frozen = launchInputOf(form);
    const before = [launchIntent(frozen), launchKeyOf(ACCOUNT, 1, frozen)];
    form.customReserveAsset.symbol = "USDC.e";
    expect([launchIntent(frozen), launchKeyOf(ACCOUNT, 1, frozen)]).toEqual(before);
  });
});
